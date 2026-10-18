// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Authority } from '@shared/models/authority.enum';
import { MenuId } from '@core/services/menu.models';
import { PlantOverviewComponent } from './plant-overview.component';

const routes: Routes = [
  {
    path: 'overview',
    component: PlantOverviewComponent,
    data: {
      auth: [Authority.TENANT_ADMIN, Authority.CUSTOMER_USER],
      title: 'mutech.plant-overview',
      breadcrumb: {
        menuId: MenuId.plant_overview
      }
    }
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class OverviewRoutingModule { }
