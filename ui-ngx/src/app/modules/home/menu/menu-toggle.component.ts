// SPDX-FileCopyrightText: Copyright The Thingsboard Authors
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileContributor: Modified by MuTech Automation
import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { MenuSection } from '@core/services/menu.models';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
import { ActionPreferencesUpdateOpenedMenuSection } from '@core/auth/auth.actions';

@Component({
    selector: 'tb-menu-toggle',
    templateUrl: './menu-toggle.component.html',
    styleUrls: ['./menu-toggle.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class MenuToggleComponent implements OnInit {

  @Input() section: MenuSection;

  @Input() compact = false;

  constructor(private router: Router,
              private store: Store<AppState>) {
  }

  ngOnInit() {
  }

  isActive(): boolean {
    return this.section.pages?.some(page => this.router.url.startsWith(page.path)) ?? false;
  }

  sectionHeight(): string {
    if (this.section.opened) {
      return this.section.pages.length * 42 + 'px';
    } else {
      return '0px';
    }
  }

  toggleSection(event: MouseEvent) {
    event.stopPropagation();
    this.section.opened = !this.section.opened;
    this.store.dispatch(new ActionPreferencesUpdateOpenedMenuSection({path: this.section.path, opened: this.section.opened}));
  }

  trackBySectionPages(index: number, section: MenuSection){
    return section.id;
  }
}
