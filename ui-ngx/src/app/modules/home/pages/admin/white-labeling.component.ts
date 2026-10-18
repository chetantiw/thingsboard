// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { MatChipInputEvent } from '@angular/material/chips';
import { COMMA, ENTER, SPACE } from '@angular/cdk/keycodes';
import { AppState } from '@core/core.state';
import { PageComponent } from '@shared/components/page.component';
import { HasConfirmForm } from '@core/guards/confirm-on-exit.guard';
import { getCurrentAuthUser } from '@core/auth/auth.selectors';
import { Authority } from '@shared/models/authority.enum';
import { EntityType } from '@shared/models/entity-type.models';
import { BrandingService } from '@core/services/branding.service';
import { DialogService } from '@core/services/dialog.service';
import {
  Branding,
  BRANDING_IMAGE_MAX_BYTES,
  BrandingLevel,
  DEFAULT_APP_TITLE
} from '@shared/models/branding.models';

type ScopeType = 'own' | 'child';

const TEXT_FIELDS = ['appTitle', 'loginHeadline', 'loginSubtitle', 'footerText', 'poweredByText'];
const IMAGE_FIELDS = ['logoUrl', 'emblemUrl', 'faviconUrl', 'loginLogoUrl', 'loginBackgroundUrl'];
const COLOR_FIELDS = ['primaryColor', 'accentColor'];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

@Component({
  selector: 'tb-white-labeling',
  templateUrl: './white-labeling.component.html',
  styleUrls: ['./white-labeling.component.scss'],
  standalone: false
})
export class WhiteLabelingComponent extends PageComponent implements OnInit, HasConfirmForm {

  readonly isSysAdmin: boolean;
  readonly childEntityType: EntityType;
  readonly imageMaxBytes = BRANDING_IMAGE_MAX_BYTES;
  readonly chipSeparators = [ENTER, COMMA, SPACE];
  readonly colorFields: (keyof Branding)[] = ['primaryColor', 'accentColor'];

  // MuTech-IoT is the brand whenever nothing is set at any level.
  readonly defaults: Branding = {
    appTitle: DEFAULT_APP_TITLE,
    logoUrl: 'assets/logo_title_white.svg',
    emblemUrl: 'assets/mutech-emblem.png',
    faviconUrl: 'assets/favicon.ico',
    loginLogoUrl: 'assets/logo_title_white.svg',
    loginBackgroundUrl: 'assets/login_background.jpg',
    primaryColor: '#1B1961',
    accentColor: '#13B5C9'
  };

  scopeType: ScopeType = 'own';
  childId: string = null;
  inherited: Branding = {};
  domains: string[] = [];
  loaded = false;

  form: FormGroup;

  constructor(protected store: Store<AppState>,
              private fb: FormBuilder,
              private brandingService: BrandingService,
              private dialogService: DialogService,
              private translate: TranslateService) {
    super(store);
    const authUser = getCurrentAuthUser(store);
    this.isSysAdmin = authUser.authority === Authority.SYS_ADMIN;
    this.childEntityType = this.isSysAdmin ? EntityType.TENANT : EntityType.CUSTOMER;
    this.form = this.fb.group({
      appTitle: ['', Validators.maxLength(500)],
      logoUrl: [null],
      emblemUrl: [null],
      faviconUrl: [null],
      primaryColor: ['', Validators.pattern(HEX_COLOR)],
      accentColor: ['', Validators.pattern(HEX_COLOR)],
      loginLogoUrl: [null],
      loginBackgroundUrl: [null],
      loginHeadline: ['', Validators.maxLength(500)],
      loginSubtitle: ['', Validators.maxLength(500)],
      footerText: ['', Validators.maxLength(500)],
      poweredByText: ['', Validators.maxLength(500)],
      hidePoweredBy: [false],
      showHelpLinks: [false]
    });
    this.defaults.loginHeadline = this.translate.instant('mutech.hero-title');
    this.defaults.loginSubtitle = this.translate.instant('mutech.hero-subtitle');
    this.defaults.footerText = this.translate.instant('mutech.copyright', {year: new Date().getFullYear()});
    this.defaults.poweredByText = this.translate.instant('mutech.powered-by-default');
  }

  ngOnInit() {
    this.load();
  }

  get level(): BrandingLevel {
    if (this.scopeType === 'own') {
      return this.isSysAdmin ? 'system' : 'tenant';
    }
    return this.isSysAdmin ? 'tenant' : 'customer';
  }

  get domainsSupported(): boolean {
    return this.level !== 'system';
  }

  get ready(): boolean {
    return this.scopeType === 'own' || !!this.childId;
  }

  confirmForm(): FormGroup {
    return this.form;
  }

  onScopeTypeChange(scopeType: ScopeType) {
    this.scopeType = scopeType;
    this.childId = null;
    this.load();
  }

  onChildChange(childId: string) {
    this.childId = childId;
    this.load();
  }

  // Value shown for a field: what is set here, else what it inherits, else the MuTech-IoT default.
  effective(field: keyof Branding): any {
    const value = this.form.get(field as string)?.value;
    if (value !== null && value !== undefined && value !== '' && value !== false) {
      return value;
    }
    return this.inherited[field] ?? this.defaults[field];
  }

  inheritedHint(field: keyof Branding): string {
    const value = this.inherited[field] ?? this.defaults[field];
    return typeof value === 'string' && !value.startsWith('data:') ? value : '';
  }

  inheritsFrom(): string {
    switch (this.level) {
      case 'system':
        return 'mutech.inherits-mutech';
      case 'tenant':
        return 'mutech.inherits-platform';
      default:
        return 'mutech.inherits-tenant';
    }
  }

  get palette() {
    return this.brandingService.brandPalette({
      primaryColor: this.effective('primaryColor'),
      accentColor: this.effective('accentColor')
    });
  }

  // Like the login page: its own logo, else the sidebar logo, else the MuTech-IoT logo.
  loginLogo(): string {
    return this.form.value.loginLogoUrl || this.inherited.loginLogoUrl || this.form.value.logoUrl
      || this.inherited.logoUrl || this.defaults.loginLogoUrl;
  }

  previewBackground(): string {
    const url = this.effective('loginBackgroundUrl') as string;
    return url ? `url("${url.replace(/["\\]/g, '')}")` : 'none';
  }

  setColor(field: string, value: string) {
    this.form.get(field).setValue(value.toUpperCase());
    this.form.markAsDirty();
  }

  addDomain(event: MatChipInputEvent) {
    const value = (event.value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (value && !this.domains.includes(value)) {
      this.domains = [...this.domains, value];
      this.form.markAsDirty();
    }
    event.chipInput.clear();
  }

  removeDomain(domain: string) {
    this.domains = this.domains.filter(d => d !== domain);
    this.form.markAsDirty();
  }

  save() {
    const value = this.form.value;
    const branding: Branding = {};
    for (const field of [...TEXT_FIELDS, ...IMAGE_FIELDS, ...COLOR_FIELDS]) {
      const fieldValue = (value[field] || '').trim();
      if (fieldValue) {
        branding[field] = fieldValue;
      }
    }
    // Switches are stored only where they differ from the inherited value, so either way can be overridden.
    for (const flag of ['hidePoweredBy', 'showHelpLinks']) {
      if (!!value[flag] !== !!this.inherited[flag]) {
        branding[flag] = !!value[flag];
      }
    }
    if (this.domainsSupported && this.domains.length) {
      branding.domains = this.domains;
    }
    this.brandingService.saveSettings(this.level, branding, this.tenantParam(), this.customerParam()).subscribe(saved => {
      this.setValue(saved);
      this.brandingService.reload();
    });
  }

  resetToInherited() {
    this.dialogService.confirm(
      this.translate.instant('mutech.white-labeling-reset-title'),
      this.translate.instant('mutech.white-labeling-reset-text'),
      this.translate.instant('action.no'),
      this.translate.instant('action.yes')
    ).subscribe(confirmed => {
      if (confirmed) {
        this.brandingService.deleteSettings(this.level, this.tenantParam(), this.customerParam()).subscribe(() => {
          this.setValue({});
          this.brandingService.reload();
        });
      }
    });
  }

  private load() {
    this.loaded = false;
    if (!this.ready) {
      this.inherited = {};
      this.setValue({});
      return;
    }
    this.brandingService.getSettings(this.level, this.tenantParam(), this.customerParam()).subscribe(settings => {
      this.inherited = settings.inherited || {};
      this.setValue(settings.branding || {});
      this.loaded = true;
    });
  }

  private setValue(branding: Branding) {
    this.form.reset({
      appTitle: branding.appTitle || '',
      logoUrl: branding.logoUrl || null,
      emblemUrl: branding.emblemUrl || null,
      faviconUrl: branding.faviconUrl || null,
      primaryColor: branding.primaryColor || '',
      accentColor: branding.accentColor || '',
      loginLogoUrl: branding.loginLogoUrl || null,
      loginBackgroundUrl: branding.loginBackgroundUrl || null,
      loginHeadline: branding.loginHeadline || '',
      loginSubtitle: branding.loginSubtitle || '',
      footerText: branding.footerText || '',
      poweredByText: branding.poweredByText || '',
      hidePoweredBy: branding.hidePoweredBy ?? !!this.inherited.hidePoweredBy,
      showHelpLinks: branding.showHelpLinks ?? !!this.inherited.showHelpLinks
    });
    this.domains = branding.domains || [];
  }

  private tenantParam(): string {
    return this.isSysAdmin && this.scopeType === 'child' ? this.childId : undefined;
  }

  private customerParam(): string {
    return !this.isSysAdmin && this.scopeType === 'child' ? this.childId : undefined;
  }
}
