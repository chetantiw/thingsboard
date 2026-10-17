// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { combineLatest, Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { MenuService } from '@core/services/menu.service';
import { MenuSection } from '@core/services/menu.models';
import { UtilsService } from '@core/services/utils.service';
import { AppearanceService } from '@core/services/appearance.service';
import { appearanceThemes } from '@shared/models/appearance.models';

interface CommandItem {
  label: string;
  group: string;
  icon: string;
  run: () => void;
}

@Component({
  selector: 'tb-command-palette-dialog',
  templateUrl: './command-palette-dialog.component.html',
  styleUrls: ['./command-palette-dialog.component.scss'],
  standalone: false
})
export class CommandPaletteDialogComponent {

  static readonly dialogId = 'mt-command-palette';

  query = this.fb.control('', {nonNullable: true});
  activeIndex = 0;
  items: CommandItem[] = [];

  readonly items$: Observable<CommandItem[]> = combineLatest([
    this.menuService.menuSections().pipe(map(sections => this.toCommands(sections))),
    this.query.valueChanges.pipe(startWith(''))
  ]).pipe(
    map(([commands, query]) => {
      const text = query.trim().toLowerCase();
      this.activeIndex = 0;
      this.items = text ? commands.filter(c => `${c.label} ${c.group}`.toLowerCase().includes(text)) : commands;
      return this.items;
    })
  );

  constructor(private dialogRef: MatDialogRef<CommandPaletteDialogComponent>,
              private fb: FormBuilder,
              private router: Router,
              private menuService: MenuService,
              private translate: TranslateService,
              private utils: UtilsService,
              private appearanceService: AppearanceService) {
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex = Math.min(this.activeIndex + 1, this.items.length - 1);
      this.scrollActiveIntoView();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex = Math.max(this.activeIndex - 1, 0);
      this.scrollActiveIntoView();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = this.items[this.activeIndex];
      if (item) {
        this.execute(item);
      }
    }
  }

  execute(item: CommandItem) {
    this.dialogRef.close();
    item.run();
  }

  private scrollActiveIntoView() {
    setTimeout(() => document.getElementById(`mt-command-${this.activeIndex}`)?.scrollIntoView({block: 'nearest'}));
  }

  private sectionName(section: MenuSection): string {
    return section.customTranslate ? this.utils.customTranslation(section.name, section.name) : this.translate.instant(section.name);
  }

  private toCommands(sections: MenuSection[]): CommandItem[] {
    const navigate = this.translate.instant('mutech.go-to');
    const commands: CommandItem[] = [];
    const addLink = (section: MenuSection, group: string) => commands.push({
      label: this.sectionName(section),
      group,
      icon: section.icon,
      run: () => this.router.navigateByUrl(section.path)
    });
    for (const section of sections) {
      if (section.type === 'link') {
        addLink(section, navigate);
      } else {
        section.pages?.forEach(page => addLink(page, this.sectionName(section)));
      }
    }
    const appearance = this.translate.instant('mutech.appearance');
    for (const theme of appearanceThemes) {
      commands.push({
        label: this.translate.instant('mutech.switch-theme', {theme: theme.name}),
        group: appearance,
        icon: theme.dark ? 'dark_mode' : 'light_mode',
        run: () => this.appearanceService.update({theme: theme.id, followSystem: false})
      });
    }
    const layout = this.appearanceService.appearance.layout === 'classic' ? 'control' : 'classic';
    commands.push({
      label: this.translate.instant(layout === 'control' ? 'mutech.switch-to-control-room' : 'mutech.switch-to-classic'),
      group: appearance,
      icon: layout === 'control' ? 'view_sidebar' : 'view_quilt',
      run: () => this.appearanceService.update({layout})
    });
    return commands;
  }
}
