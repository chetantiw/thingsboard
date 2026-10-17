// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
import { DOCUMENT, Inject, Injectable } from '@angular/core';
import { select, Store } from '@ngrx/store';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { AppState } from '@core/core.state';
import { selectUserSettings } from '@core/auth/auth.selectors';
import { ActionPreferencesPutUserSettings } from '@core/auth/auth.actions';
import { WINDOW } from '@core/services/window.service';
import { isEqual } from '@core/utils';
import {
  APPEARANCE_STORAGE_KEY,
  Appearance,
  AppearanceTheme,
  appearanceThemes,
  defaultAppearance
} from '@shared/models/appearance.models';

@Injectable({
  providedIn: 'root'
})
export class AppearanceService {

  private appearanceSubject = new BehaviorSubject<Appearance>(this.loadLocal());
  private systemDarkQuery: MediaQueryList;

  readonly appearance$: Observable<Appearance> = this.appearanceSubject.asObservable();
  readonly compactNavigation$: Observable<boolean> = this.appearance$.pipe(
    map(appearance => appearance.layout === 'control'),
    distinctUntilChanged()
  );

  constructor(private store: Store<AppState>,
              @Inject(DOCUMENT) private document: Document,
              @Inject(WINDOW) private window: Window) {
    this.systemDarkQuery = this.window.matchMedia?.('(prefers-color-scheme: dark)');
    this.systemDarkQuery?.addEventListener?.('change', () => this.apply(this.appearance));
    this.apply(this.appearance);

    // Saved per-user settings win over the browser-local copy once the user is loaded.
    this.store.pipe(
      select(selectUserSettings),
      map(settings => settings?.appearance),
      distinctUntilChanged(isEqual)
    ).subscribe(saved => {
      if (saved) {
        this.setAppearance({...defaultAppearance, ...saved}, false);
      }
    });
  }

  get appearance(): Appearance {
    return this.appearanceSubject.value;
  }

  update(changes: Partial<Appearance>) {
    this.setAppearance({...this.appearance, ...changes}, true);
  }

  effectiveTheme(appearance = this.appearance): AppearanceTheme {
    const selected = appearanceThemes.find(t => t.id === appearance.theme) ?? appearanceThemes[0];
    if (!appearance.followSystem || !this.systemDarkQuery) {
      return selected.id;
    }
    if (this.systemDarkQuery.matches) {
      return selected.dark ? selected.id : 'midnight';
    }
    return selected.dark ? 'indigo' : selected.id;
  }

  private setAppearance(appearance: Appearance, persist: boolean) {
    if (!isEqual(appearance, this.appearance)) {
      this.appearanceSubject.next(appearance);
      this.apply(appearance);
      this.saveLocal(appearance);
    }
    if (persist) {
      this.store.dispatch(new ActionPreferencesPutUserSettings({appearance}));
    }
  }

  private apply(appearance: Appearance) {
    const classList = this.document.body.classList;
    Array.from(classList)
      .filter(className => /^mt-(theme|layout|density)-/.test(className))
      .forEach(className => classList.remove(className));
    const theme = this.effectiveTheme(appearance);
    classList.add(`mt-theme-${theme}`, `mt-layout-${appearance.layout}`, `mt-density-${appearance.density}`);
    classList.toggle('mt-dark', appearanceThemes.find(t => t.id === theme)?.dark ?? false);
  }

  private loadLocal(): Appearance {
    try {
      const stored = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY));
      return {...defaultAppearance, ...stored};
    } catch {
      return {...defaultAppearance};
    }
  }

  private saveLocal(appearance: Appearance) {
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      // Storage may be unavailable (private mode); the server copy still applies.
    }
  }
}
