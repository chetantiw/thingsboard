// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { environment as env } from '@env/environment';

// Open-source and license notices. Always available, whatever the white labeling hides.
@Component({
  selector: 'tb-legal-notices-dialog',
  templateUrl: './legal-notices-dialog.component.html',
  styleUrls: ['./legal-notices-dialog.component.scss'],
  standalone: false
})
export class LegalNoticesDialogComponent {

  readonly version = env.tbVersion;

  readonly documents = [
    {name: 'mutech.legal-apache-license', url: 'assets/legal/LICENSE.txt'},
    {name: 'mutech.legal-modifications', url: 'assets/legal/NOTICE.txt'},
    {name: 'mutech.legal-third-party', url: '3rdpartylicenses.txt'},
    {name: 'mutech.legal-fonts', url: 'assets/fonts/mutech/manrope-LICENSE.txt'}
  ];

  constructor(private dialogRef: MatDialogRef<LegalNoticesDialogComponent>) {
  }

  close() {
    this.dialogRef.close();
  }
}
