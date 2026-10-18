// SPDX-FileCopyrightText: Copyright The Thingsboard Authors
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileContributor: Modified by MuTech Automation
import { Title } from '@angular/platform-browser';
import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs/operators';

import { BrandingService } from '@core/services/branding.service';

@Injectable({
  providedIn: 'root'
})
export class TitleService {
  constructor(
    private translate: TranslateService,
    private title: Title,
    private brandingService: BrandingService
  ) {}

  setTitle(
    snapshot: ActivatedRouteSnapshot,
    lazyTranslate?: TranslateService
  ) {
    let lastChild = snapshot;
    while (lastChild.children.length) {
      lastChild = lastChild.children[0];
    }
    const { title } = lastChild.data;
    const translate = lazyTranslate || this.translate;
    if (title) {
      translate
        .get(title)
        .pipe(filter(translatedTitle => translatedTitle !== title))
        .subscribe(translatedTitle =>
          this.title.setTitle(`${this.brandingService.appTitle} | ${translatedTitle}`)
        );
    } else {
      this.title.setTitle(this.brandingService.appTitle);
    }
  }
}
