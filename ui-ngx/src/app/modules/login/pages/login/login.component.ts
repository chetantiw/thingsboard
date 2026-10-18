// SPDX-FileCopyrightText: Copyright The Thingsboard Authors
// SPDX-License-Identifier: Apache-2.0
import { MatDialog } from '@angular/material/dialog';
import { BrandingService } from '@core/services/branding.service';
import { Branding } from '@shared/models/branding.models';
import { LegalNoticesDialogComponent } from '@shared/components/legal-notices-dialog.component';
import { Component, OnInit } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import { UntypedFormBuilder, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Constants } from '@shared/models/constants';
import { Router } from '@angular/router';
import { OAuth2ClientLoginInfo } from '@shared/models/oauth2.models';
import { validateEmail } from '@app/core/utils';
import { PageComponent } from '@shared/components/page.component';
import { finalize } from 'rxjs/operators';

@Component({
    selector: 'tb-login',
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.scss'],
    standalone: false
})
export class LoginComponent extends PageComponent implements OnInit {

  passwordViolation = false;
  isLoading = false;
  year = new Date().getFullYear();

  loginFormGroup = this.fb.group({
    username: ['', [Validators.required, validateEmail]],
    password: ['']
  });
  oauth2Clients: Array<OAuth2ClientLoginInfo> = null;

  branding$ = this.brandingService.branding$;

  constructor(private authService: AuthService,
              public fb: UntypedFormBuilder,
              private router: Router,
              private brandingService: BrandingService,
              private dialog: MatDialog) {
    super();
  }

  loginImage(branding: Branding): string | null {
    return branding?.loginBackgroundUrl ? `url("${branding.loginBackgroundUrl.replace(/["\\]/g, '')}")` : null;
  }

  openLegalNotices() {
    this.dialog.open(LegalNoticesDialogComponent, {panelClass: ['tb-dialog'], autoFocus: false});
  }

  ngOnInit() {
    this.oauth2Clients = this.authService.oauth2Clients;
  }

  login(): void {
    if (this.loginFormGroup.valid) {
      this.isLoading = true;
      this.authService.login(this.loginFormGroup.value).pipe(
        finalize(() => {this.isLoading = false;})
      ).subscribe({
        error: (error: HttpErrorResponse) => {
          if (error && error.error && error.error.errorCode) {
            if (error.error.errorCode === Constants.serverErrorCode.credentialsExpired) {
              this.router.navigateByUrl(`login/resetExpiredPassword?resetToken=${error.error.resetToken}`);
            } else if (error.error.errorCode === Constants.serverErrorCode.passwordViolation) {
              this.passwordViolation = true;
            }
          }
        }
      });
    } else {
      this.loginFormGroup.markAllAsTouched();
    }
  }

  getOAuth2Uri(oauth2Client: OAuth2ClientLoginInfo): string {
    let result = "";
    if (this.authService.redirectUrl) {
      result += "?prevUri=" + encodeURIComponent(this.authService.redirectUrl);
    }
    return oauth2Client.url + result;
  }
}
