// SPDX-FileCopyrightText: Copyright The Thingsboard Authors
// SPDX-License-Identifier: Apache-2.0
import { inject, NgModule } from '@angular/core';
import { CanActivateFn, Router, RouterModule, Routes } from '@angular/router';
import { select, Store } from '@ngrx/store';
import { filter, map, take } from 'rxjs/operators';
import { AppState } from '@core/core.state';
import { AuthService } from '@core/auth/auth.service';
import { selectIsUserLoaded } from '@core/auth/auth.selectors';

// Sends the bare URL to the user's chosen start page once their settings are loaded.
const startPageGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return inject(Store<AppState>).pipe(
    select(selectIsUserLoaded),
    filter(Boolean),
    take(1),
    map(() => router.parseUrl(authService.startPage()))
  );
};

const routes: Routes = [
  { path: '',
    pathMatch: 'full',
    canActivate: [startPageGuard],
    children: [],
    data: {
      breadcrumb: {
        skip: true
      }
    }
  }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
