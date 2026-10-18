// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
import { DOCUMENT, Inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { select, Store } from '@ngrx/store';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import tinycolor from 'tinycolor2';
import { AppState } from '@core/core.state';
import { selectUserReady } from '@core/auth/auth.selectors';
import { defaultHttpOptionsFromConfig } from '@core/http/http-utils';
import { isEqual } from '@core/utils';
import { AppearanceService } from '@core/services/appearance.service';
import {
  Branding,
  BRANDING_STORAGE_KEY,
  BrandingLevel,
  BrandingSettings,
  DEFAULT_APP_TITLE
} from '@shared/models/branding.models';
import { notifyMtWidgetThemeChanged } from '@shared/models/mutech-widget-theme';

// Material color tokens that carry the primary color, overridden with the brand primary in light themes.
const MATERIAL_PRIMARY_TOKENS = [
  'radio-selected-pressed-icon-color', 'radio-selected-icon-color', 'radio-selected-hover-icon-color',
  'radio-selected-focus-icon-color', 'radio-checked-ripple-color', 'checkbox-selected-pressed-state-layer-color',
  'checkbox-selected-pressed-icon-color', 'checkbox-selected-icon-color', 'checkbox-selected-hover-state-layer-color',
  'checkbox-selected-hover-icon-color', 'checkbox-selected-focus-state-layer-color', 'checkbox-selected-focus-icon-color',
  'toolbar-container-background-color', 'tab-inactive-ripple-color', 'tab-active-ripple-color', 'tab-active-label-text-color',
  'tab-active-indicator-color', 'tab-active-hover-label-text-color', 'tab-active-hover-indicator-color',
  'tab-active-focus-label-text-color', 'tab-active-focus-indicator-color', 'stepper-header-selected-state-icon-background-color',
  'stepper-header-edit-state-icon-background-color', 'stepper-header-done-state-icon-background-color', 'slider-ripple-color',
  'slider-hover-handle-color', 'slider-handle-color', 'slider-focus-handle-color', 'slider-active-track-color',
  'slide-toggle-selected-pressed-state-layer-color', 'slide-toggle-selected-pressed-handle-color',
  'slide-toggle-selected-hover-state-layer-color', 'slide-toggle-selected-hover-handle-color',
  'slide-toggle-selected-handle-color', 'slide-toggle-selected-focus-state-layer-color',
  'slide-toggle-selected-focus-handle-color', 'select-focused-arrow-color', 'pseudo-checkbox-minimal-selected-checkmark-color',
  'pseudo-checkbox-full-selected-icon-color', 'option-selected-state-label-text-color', 'icon-button-state-layer-color',
  'form-field-outlined-focus-outline-color', 'form-field-outlined-caret-color', 'form-field-filled-focus-active-indicator-color',
  'form-field-filled-caret-color', 'fab-small-container-color', 'fab-container-color',
  'datepicker-toggle-active-state-icon-color', 'datepicker-calendar-date-selected-state-background-color',
  'chip-elevated-selected-container-color', 'button-tonal-container-color', 'button-text-state-layer-color',
  'button-text-label-text-color', 'button-protected-container-color', 'button-outlined-state-layer-color',
  'button-outlined-label-text-color', 'button-filled-container-color', 'badge-background-color'
];

// Material tokens for text drawn on the primary color.
const MATERIAL_ON_PRIMARY_TOKENS = [
  'button-filled-label-text-color', 'button-protected-label-text-color', 'fab-foreground-color', 'fab-small-foreground-color',
  'toolbar-container-text-color', 'badge-text-color', 'checkbox-selected-checkmark-color',
  'datepicker-calendar-date-selected-state-text-color', 'slider-label-label-text-color'
];

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

@Injectable({
  providedIn: 'root'
})
export class BrandingService {

  private brandingSubject = new BehaviorSubject<Branding>(this.loadLocal());
  private styleElement: HTMLStyleElement;

  readonly branding$: Observable<Branding> = this.brandingSubject.asObservable();
  readonly appTitle$ = this.branding$.pipe(map(b => b.appTitle || DEFAULT_APP_TITLE), distinctUntilChanged());

  constructor(private http: HttpClient,
              private store: Store<AppState>,
              private title: Title,
              private appearanceService: AppearanceService,
              @Inject(DOCUMENT) private document: Document) {
    this.apply(this.branding);
    // Signed-in users get their tenant/customer brand; the login page gets the brand of this domain.
    this.store.pipe(
      select(selectUserReady),
      distinctUntilChanged(isEqual),
      switchMap(({isAuthenticated, isUserLoaded}) => {
        if (isAuthenticated && !isUserLoaded) {
          return of(null);
        }
        return isAuthenticated ? this.fetchCurrent() : this.fetchForDomain();
      })
    ).subscribe(branding => {
      if (branding) {
        this.setBranding(branding);
      }
    });
    // Brand colors are applied differently in light and dark themes.
    // The appearance service updates the body classes right after emitting.
    this.appearanceService.appearance$.subscribe(() => setTimeout(() => this.applyColors(this.branding)));
  }

  get branding(): Branding {
    return this.brandingSubject.value;
  }

  get appTitle(): string {
    return this.branding.appTitle || DEFAULT_APP_TITLE;
  }

  reload() {
    this.fetchCurrent().subscribe(branding => this.setBranding(branding));
  }

  getSettings(level: BrandingLevel, tenantId?: string, customerId?: string): Observable<BrandingSettings> {
    return this.http.get<BrandingSettings>(this.settingsUrl(level, tenantId, customerId), defaultHttpOptionsFromConfig());
  }

  saveSettings(level: BrandingLevel, branding: Branding, tenantId?: string, customerId?: string): Observable<Branding> {
    return this.http.post<Branding>(this.settingsUrl(level, tenantId, customerId), branding, defaultHttpOptionsFromConfig());
  }

  deleteSettings(level: BrandingLevel, tenantId?: string, customerId?: string): Observable<void> {
    return this.http.delete<void>(this.settingsUrl(level, tenantId, customerId), defaultHttpOptionsFromConfig());
  }

  // Colors as the brand would show them, for previews in the settings page.
  brandPalette(branding: Branding): {primary: string; onPrimary: string; rail: string; accent: string} {
    const primary = COLOR_PATTERN.test(branding.primaryColor || '') ? branding.primaryColor : '#1B1961';
    const accent = COLOR_PATTERN.test(branding.accentColor || '') ? branding.accentColor : primary;
    return {primary, onPrimary: this.onColor(primary), rail: this.railColor(primary), accent};
  }

  private settingsUrl(level: BrandingLevel, tenantId?: string, customerId?: string): string {
    let url = `/api/mutech/branding/settings?level=${level}`;
    if (tenantId) {
      url += `&tenantId=${encodeURIComponent(tenantId)}`;
    }
    if (customerId) {
      url += `&customerId=${encodeURIComponent(customerId)}`;
    }
    return url;
  }

  private fetchCurrent(): Observable<Branding> {
    return this.http.get<Branding>('/api/mutech/branding', defaultHttpOptionsFromConfig({ignoreLoading: true, ignoreErrors: true}))
      .pipe(catchError(() => of(null)));
  }

  private fetchForDomain(): Observable<Branding> {
    const url = `/api/noauth/mutech/branding?domain=${encodeURIComponent(this.document.location.hostname)}`;
    return this.http.get<Branding>(url, defaultHttpOptionsFromConfig({ignoreLoading: true, ignoreErrors: true}))
      .pipe(catchError(() => of(null)));
  }

  private setBranding(branding: Branding) {
    if (!isEqual(branding, this.branding)) {
      this.brandingSubject.next(branding);
      this.apply(branding);
      this.saveLocal(branding);
      notifyMtWidgetThemeChanged();
    }
  }

  private apply(branding: Branding) {
    this.applyColors(branding);
    const favicon = this.document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) {
      favicon.href = branding.faviconUrl || 'assets/favicon.ico';
    }
    const current = this.title.getTitle();
    const separator = current.indexOf(' | ');
    this.title.setTitle((branding.appTitle || DEFAULT_APP_TITLE) + (separator >= 0 ? current.substring(separator) : ''));
    this.document.body.classList.toggle('mt-hide-help', !!branding.hideHelpLinks);
  }

  private applyColors(branding: Branding) {
    const body = this.document.body;
    const primary = COLOR_PATTERN.test(branding.primaryColor || '') ? branding.primaryColor : null;
    const accent = COLOR_PATTERN.test(branding.accentColor || '') ? branding.accentColor : null;
    const dark = body.classList.contains('mt-dark');
    let css = '';
    if (primary && !dark) {
      const onPrimary = this.onColor(primary);
      const rail = this.railColor(primary);
      const tokens = [
        `--mt-primary: ${primary}`, `--mt-on-primary: ${onPrimary}`,
        `--mt-primary-soft: ${tinycolor(primary).setAlpha(0.1).toRgbString()}`,
        `--mt-rail: ${rail}`, `--mt-rail-header: ${tinycolor.mix(rail, '#000', 25).toHexString()}`,
        `--mt-rail-border: ${tinycolor.mix(rail, '#fff', 15).toHexString()}`, `--mt-nav-active-text: ${rail}`,
        ...MATERIAL_PRIMARY_TOKENS.map(token => `--mat-${token}: ${primary}`),
        ...MATERIAL_ON_PRIMARY_TOKENS.map(token => `--mat-${token}: ${onPrimary}`)
      ].join('; ');
      // Material sets these tokens on .tb-default and on every .mat-primary component.
      css += `body.tb-default.mt-branded, body.tb-default.mt-branded .mat-primary { ${tokens}; }\n`;
    }
    // Dark themes keep their own palette; a dark brand primary is brightened to serve as the accent.
    const accentColor = accent || (primary && dark ? this.brightColor(primary) : null);
    if (accentColor) {
      css += `body.tb-default.mt-branded { --mt-accent: ${accentColor}; --mt-indicator: ${accentColor}; }\n`;
    }
    body.classList.toggle('mt-branded', !!css);
    if (!this.styleElement) {
      this.styleElement = this.document.createElement('style');
      this.styleElement.id = 'mt-brand-colors';
      this.document.head.appendChild(this.styleElement);
    }
    if (this.styleElement.textContent !== css) {
      this.styleElement.textContent = css;
    }
  }

  private brightColor(color: string): string {
    let result = tinycolor(color);
    for (let i = 0; i < 10 && result.getLuminance() < 0.3; i++) {
      result = result.brighten(10);
    }
    return result.toHexString();
  }

  private onColor(color: string): string {
    return tinycolor(color).getLuminance() > 0.45 ? '#15142B' : '#FFFFFF';
  }

  // The sidebar keeps light text, so a light brand color is darkened for it.
  private railColor(primary: string): string {
    const color = tinycolor(primary);
    return color.getLuminance() > 0.12 ? tinycolor.mix(primary, '#0b0b14', 55).toHexString() : color.toHexString();
  }

  private loadLocal(): Branding {
    try {
      return JSON.parse(localStorage.getItem(BRANDING_STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  private saveLocal(branding: Branding) {
    try {
      if (branding && Object.keys(branding).length) {
        localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(branding));
      } else {
        localStorage.removeItem(BRANDING_STORAGE_KEY);
      }
    } catch {
      // Storage full or unavailable: the brand is fetched again on the next visit.
    }
  }
}
