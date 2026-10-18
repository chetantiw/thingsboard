// SPDX-FileCopyrightText: Copyright The Thingsboard Authors
// SPDX-License-Identifier: Apache-2.0
import { BrandingService } from '@core/services/branding.service';
import { AfterViewInit, Component, ElementRef, HostListener, Inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { skip, startWith, Subject } from 'rxjs';
import { Store } from '@ngrx/store';
import { debounceTime, distinctUntilChanged, map, takeUntil } from 'rxjs/operators';

import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { PageComponent } from '@shared/components/page.component';
import { AppState } from '@core/core.state';
import { getCurrentAuthState } from '@core/auth/auth.selectors';
import { MediaBreakpoints } from '@shared/models/constants';
import screenfull from 'screenfull';
import { MatSidenav } from '@angular/material/sidenav';
import { AuthState } from '@core/auth/auth.models';
import { WINDOW } from '@core/services/window.service';
import { instanceOfSearchableComponent, ISearchableComponent } from '@home/models/searchable-component.models';
import { ActiveComponentService } from '@core/services/active-component.service';
import { RouterTabsComponent } from '@home/components/router-tabs.component';
import { FormBuilder } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { isDefined, isDefinedAndNotNull } from '@core/utils';
import { MatDialog } from '@angular/material/dialog';
import { AppearanceService } from '@core/services/appearance.service';
import { CommandPaletteDialogComponent } from '@home/components/mutech/command-palette-dialog.component';
import { AppearanceDialogComponent } from '@home/components/mutech/appearance-dialog.component';

@Component({
    selector: 'tb-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
    standalone: false
})
export class HomeComponent extends PageComponent implements AfterViewInit, OnInit, OnDestroy {

  authState: AuthState = getCurrentAuthState(this.store);

  forceFullscreen = this.authState.forceFullscreen;

  activeComponent: any;
  searchableComponent: ISearchableComponent;

  sidenavMode: 'over' | 'push' | 'side' = 'side';
  sidenavOpened = true;

  logo$ = this.brandingService.branding$.pipe(map(branding => branding.logoUrl || 'assets/logo_title_white.svg'));
  emblem$ = this.brandingService.branding$.pipe(map(branding => branding.emblemUrl || branding.logoUrl || 'assets/mutech-emblem.png'));
  appTitle$ = this.brandingService.appTitle$;

  compactNav$ = this.appearanceService.compactNavigation$;

  @ViewChild('sidenav')
  sidenav: MatSidenav;

  @ViewChild('mainContent', { static: true }) mainContent: ElementRef<HTMLElement>;

  @ViewChild('searchInput') searchInputField: ElementRef;

  fullscreenEnabled = screenfull.isEnabled;

  searchEnabled = false;
  showSearch = false;
  textSearch = this.fb.control('', {nonNullable: true});

  hideLoadingBar = false;

  private destroy$ = new Subject<void>();

  constructor(protected store: Store<AppState>,
              @Inject(WINDOW) private window: Window,
              private activeComponentService: ActiveComponentService,
              private fb: FormBuilder,
              private dialog: MatDialog,
              private appearanceService: AppearanceService,
              private brandingService: BrandingService,
              public breakpointObserver: BreakpointObserver) {
    super(store);
  }

  ngOnInit() {

    const isGtSm = this.breakpointObserver.isMatched(MediaBreakpoints['gt-sm']);
    this.sidenavMode = isGtSm ? 'side' : 'over';
    this.sidenavOpened = isGtSm;

    this.breakpointObserver
      .observe(MediaBreakpoints['gt-sm'])
      .pipe(takeUntil(this.destroy$))
      .subscribe((state: BreakpointState) => {
          if (state.matches) {
            this.sidenavMode = 'side';
            this.sidenavOpened = true;
          } else {
            this.sidenavMode = 'over';
            this.sidenavOpened = false;
          }
        }
      );
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngAfterViewInit() {
    this.textSearch.valueChanges.pipe(
      debounceTime(150),
      startWith(''),
      distinctUntilChanged((a: string, b: string) => a.trim() === b.trim()),
      skip(1),
      takeUntil(this.destroy$)
    ).subscribe(value => this.searchTextUpdated(value.trim()));
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 'k' && !this.forceFullscreen) {
      event.preventDefault();
      this.openCommandPalette();
    }
  }

  openCommandPalette() {
    if (!this.dialog.getDialogById(CommandPaletteDialogComponent.dialogId)) {
      this.dialog.open(CommandPaletteDialogComponent, {
        id: CommandPaletteDialogComponent.dialogId,
        panelClass: ['tb-dialog', 'mt-command-palette-panel'],
        position: {top: '12vh'},
        width: '640px',
        maxWidth: '92vw',
        autoFocus: 'first-tabbable'
      });
    }
  }

  openAppearance() {
    this.dialog.open(AppearanceDialogComponent, {
      panelClass: ['tb-dialog', 'mt-appearance-panel'],
      width: '560px',
      maxWidth: '94vw'
    });
  }

  sidenavClicked() {
    if (this.sidenavMode === 'over') {
      this.sidenav.toggle();
    }
  }

  toggleFullscreen() {
    if (screenfull.isEnabled) {
      screenfull.toggle();
    }
  }

  isFullscreen() {
    return screenfull.isFullscreen;
  }

  goBack() {
    this.window.history.back();
  }

  activeComponentChanged(activeComponent: any) {
    this.activeComponentService.setCurrentActiveComponent(activeComponent);
    this.mainContent?.nativeElement?.scrollTo({ top: 0, left: 0 });
    if (!this.activeComponent) {
      setTimeout(() => {
        this.updateActiveComponent(activeComponent);
      }, 0);
    } else {
      this.updateActiveComponent(activeComponent);
    }
  }

  private updateActiveComponent(activeComponent: any) {
    this.showSearch = false;
    this.hideLoadingBar = false;
    this.textSearch.reset('', {emitEvent: false});
    this.activeComponent = activeComponent;

    if (activeComponent && activeComponent instanceof RouterTabsComponent
      && isDefinedAndNotNull(this.activeComponent.activatedRoute?.snapshot?.data?.showMainLoadingBar)) {
      this.hideLoadingBar = !this.activeComponent.activatedRoute.snapshot.data.showMainLoadingBar;
    } else if (activeComponent && activeComponent instanceof PageComponent
      && isDefinedAndNotNull(this.activeComponent?.showMainLoadingBar)) {
      this.hideLoadingBar = !this.activeComponent.showMainLoadingBar;
    }

    if (this.activeComponent && instanceOfSearchableComponent(this.activeComponent)) {
      this.searchEnabled = true;
      this.searchableComponent = this.activeComponent;
    } else {
      this.searchEnabled = false;
      this.searchableComponent = null;
    }
  }

  displaySearchMode(): boolean {
    return this.searchEnabled && this.showSearch;
  }

  openSearch() {
    if (this.searchEnabled) {
      this.showSearch = true;
      setTimeout(() => {
        this.searchInputField.nativeElement.focus();
        this.searchInputField.nativeElement.setSelectionRange(0, 0);
      }, 10);
    }
  }

  closeSearch() {
    if (this.searchEnabled) {
      this.showSearch = false;
      if (this.textSearch.value.length) {
        this.textSearch.reset();
      }
    }
  }

  private searchTextUpdated(searchText: string) {
    if (this.searchableComponent) {
      this.searchableComponent.onSearchTextUpdated(searchText);
    }
  }
}
