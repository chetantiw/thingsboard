// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@app/shared/shared.module';
import { OverviewRoutingModule } from './overview-routing.module';
import { PlantOverviewComponent } from './plant-overview.component';

@NgModule({
  declarations: [PlantOverviewComponent],
  imports: [
    CommonModule,
    SharedModule,
    OverviewRoutingModule
  ]
})
export class OverviewModule { }
