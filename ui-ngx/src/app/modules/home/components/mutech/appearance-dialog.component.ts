// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
import { getCurrentAuthUser } from '@core/auth/auth.selectors';
import { Authority } from '@shared/models/authority.enum';
import { AppearanceService } from '@core/services/appearance.service';
import {
  Appearance,
  AppearanceDensity,
  AppearanceLayout,
  AppearanceStartPage,
  AppearanceTheme,
  appearanceThemes,
  AppearanceWidgetStyle
} from '@shared/models/appearance.models';

@Component({
  selector: 'tb-appearance-dialog',
  templateUrl: './appearance-dialog.component.html',
  styleUrls: ['./appearance-dialog.component.scss'],
  standalone: false
})
export class AppearanceDialogComponent {

  readonly themes = appearanceThemes;
  readonly layouts: {id: AppearanceLayout; name: string; hint: string}[] = [
    {id: 'classic', name: 'mutech.layout-classic', hint: 'mutech.layout-classic-hint'},
    {id: 'control', name: 'mutech.layout-control', hint: 'mutech.layout-control-hint'}
  ];
  readonly densities: {id: AppearanceDensity; name: string}[] = [
    {id: 'comfortable', name: 'mutech.density-comfortable'},
    {id: 'compact', name: 'mutech.density-compact'}
  ];

  readonly startPages: {id: AppearanceStartPage; name: string}[] = [
    {id: 'home', name: 'mutech.start-home'},
    {id: 'overview', name: 'mutech.plant-overview'}
  ];

  readonly widgetStyles: {id: AppearanceWidgetStyle; name: string}[] = [
    {id: 'mutech', name: 'mutech.widget-style-mutech'},
    {id: 'original', name: 'mutech.widget-style-original'}
  ];

  readonly appearance$ = this.appearanceService.appearance$;
  readonly startPageSupported: boolean;

  constructor(private dialogRef: MatDialogRef<AppearanceDialogComponent>,
              private appearanceService: AppearanceService,
              store: Store<AppState>) {
    const authUser = getCurrentAuthUser(store);
    this.startPageSupported = !authUser.isPublic &&
      (authUser.authority === Authority.TENANT_ADMIN || authUser.authority === Authority.CUSTOMER_USER);
  }

  setStartPage(startPage: AppearanceStartPage) {
    this.appearanceService.update({startPage});
  }

  setWidgetStyle(widgetStyle: AppearanceWidgetStyle) {
    this.appearanceService.update({widgetStyle});
  }

  setLayout(layout: AppearanceLayout) {
    this.appearanceService.update({layout});
  }

  setTheme(theme: AppearanceTheme) {
    this.appearanceService.update({theme});
  }

  setDensity(density: AppearanceDensity) {
    this.appearanceService.update({density});
  }

  setFollowSystem(followSystem: boolean) {
    this.appearanceService.update({followSystem});
  }

  isSelectedTheme(appearance: Appearance, theme: AppearanceTheme): boolean {
    return appearance.theme === theme;
  }

  close() {
    this.dialogRef.close();
  }
}
