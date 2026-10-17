// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { AppearanceService } from '@core/services/appearance.service';
import {
  Appearance,
  AppearanceDensity,
  AppearanceLayout,
  AppearanceTheme,
  appearanceThemes
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

  readonly appearance$ = this.appearanceService.appearance$;

  constructor(private dialogRef: MatDialogRef<AppearanceDialogComponent>,
              private appearanceService: AppearanceService) {
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
