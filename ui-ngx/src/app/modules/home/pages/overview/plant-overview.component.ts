// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { forkJoin, Observable, of, Subject, timer } from 'rxjs';
import { catchError, debounceTime, map, switchMap, takeUntil } from 'rxjs/operators';
import { EntityService } from '@core/http/entity.service';
import { AlarmService } from '@core/http/alarm.service';
import { EntityRelationService } from '@core/http/entity-relation.service';
import { AttributeService } from '@core/http/attribute.service';
import { EntityType } from '@shared/models/entity-type.models';
import { AliasFilterType } from '@shared/models/alias.models';
import { EntityData, EntityDataQuery, EntityKeyType } from '@shared/models/query/query.models';
import { AlarmInfo, AlarmQueryV2, AlarmSearchStatus, AlarmSeverity } from '@shared/models/alarm.models';
import { TimePageLink } from '@shared/models/page/page-link';
import { Direction } from '@shared/models/page/sort-order';
import { AggregationType } from '@shared/models/time/time.models';
import { EntityId } from '@shared/models/id/entity-id';

type ZoneStatus = 'ok' | 'warn' | 'crit';

interface DeviceSummary {
  id: string;
  entityId: EntityId;
  name: string;
  type: string;
  active: boolean;
  power?: number;
}

interface Zone {
  name: string;
  link: string;
  online: number;
  total: number;
  alarms: number;
  status: ZoneStatus;
}

interface PowerBar {
  x: number;
  y: number;
  height: number;
  current: boolean;
  label: string;
}

interface OverviewData {
  health: number | null;
  online: number;
  offline: number;
  alarmed: number;
  totalDevices: number;
  zones: Zone[];
  zonesFromAssets: boolean;
  powerTotal: number | null;
  powerDevices: number;
  powerBars: PowerBar[];
  events: AlarmInfo[];
}

const REFRESH_MS = 30000;
const DEVICE_LIMIT = 1000;
const ZONE_LIMIT = 12;
const POWER_DEVICE_LIMIT = 25;
const HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;
const CHART_WIDTH = 760;
const CHART_HEIGHT = 180;
const POWER_KEY_STORAGE = 'mt_overview_power_key';
const quietRequest = {ignoreLoading: true, ignoreErrors: true};

const severityRank: Record<AlarmSeverity, number> = {
  [AlarmSeverity.CRITICAL]: 4,
  [AlarmSeverity.MAJOR]: 3,
  [AlarmSeverity.MINOR]: 2,
  [AlarmSeverity.WARNING]: 1,
  [AlarmSeverity.INDETERMINATE]: 0
};

@Component({
  selector: 'tb-plant-overview',
  templateUrl: './plant-overview.component.html',
  styleUrls: ['./plant-overview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class PlantOverviewComponent implements OnInit, OnDestroy {

  readonly ringRadius = 80;
  readonly ringCircumference = 2 * Math.PI * this.ringRadius;
  readonly chartWidth = CHART_WIDTH;
  readonly chartHeight = CHART_HEIGHT;

  powerKey = this.fb.control(this.loadPowerKey(), {nonNullable: true});
  data: OverviewData;
  loading = true;
  now = new Date();

  private refresh$ = new Subject<void>();
  private destroy$ = new Subject<void>();

  constructor(private entityService: EntityService,
              private alarmService: AlarmService,
              private relationService: EntityRelationService,
              private attributeService: AttributeService,
              private fb: FormBuilder,
              private cd: ChangeDetectorRef) {
  }

  ngOnInit(): void {
    this.refresh$.pipe(
      switchMap(() => this.load()),
      takeUntil(this.destroy$)
    ).subscribe(data => {
      this.data = data;
      this.loading = false;
      this.now = new Date();
      this.cd.markForCheck();
    });
    timer(0, REFRESH_MS).pipe(takeUntil(this.destroy$)).subscribe(() => this.refresh$.next());
    this.powerKey.valueChanges.pipe(debounceTime(600), takeUntil(this.destroy$)).subscribe(key => {
      try {
        localStorage.setItem(POWER_KEY_STORAGE, key.trim());
      } catch {
        // Storage may be unavailable; the key then lasts for this page only.
      }
      this.refresh$.next();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ringOffset(health: number): number {
    return this.ringCircumference * (1 - health / 100);
  }

  healthStatus(health: number | null): ZoneStatus {
    if (health === null) {
      return 'ok';
    }
    return health >= 80 ? 'ok' : health >= 50 ? 'warn' : 'crit';
  }

  severityClass(severity: AlarmSeverity): string {
    switch (severity) {
      case AlarmSeverity.CRITICAL:
      case AlarmSeverity.MAJOR:
        return 'crit';
      case AlarmSeverity.MINOR:
      case AlarmSeverity.WARNING:
        return 'warn';
      default:
        return 'info';
    }
  }

  trackByName(_index: number, zone: Zone): string {
    return zone.name;
  }

  trackByAlarm(_index: number, alarm: AlarmInfo): string {
    return alarm.id.id;
  }

  private load(): Observable<OverviewData> {
    const key = this.powerKey.value.trim();
    return forkJoin([this.loadDevices(key), this.loadActiveAlarms(), this.loadEvents()]).pipe(
      switchMap(([devices, activeAlarms, events]) =>
        forkJoin([this.loadZones(devices, activeAlarms), this.loadPower(devices, key)]).pipe(
          map(([zones, power]) => this.summarize(devices, activeAlarms, events, zones, power))
        )
      )
    );
  }

  private summarize(devices: DeviceSummary[], activeAlarms: AlarmInfo[], events: AlarmInfo[],
                    zones: {zones: Zone[]; fromAssets: boolean},
                    power: {bars: PowerBar[]; total: number | null; devices: number}): OverviewData {
    const online = devices.filter(d => d.active).length;
    const alarmedIds = new Set(activeAlarms.map(a => a.originator.id));
    const count = (severity: AlarmSeverity) => activeAlarms.filter(a => a.severity === severity).length;
    const health = devices.length
      ? Math.max(0, Math.min(100, Math.round(100 * online / devices.length
        - 8 * count(AlarmSeverity.CRITICAL) - 3 * count(AlarmSeverity.MAJOR) - count(AlarmSeverity.MINOR))))
      : null;
    return {
      health,
      online,
      offline: devices.length - online,
      alarmed: devices.filter(d => alarmedIds.has(d.id)).length,
      totalDevices: devices.length,
      zones: zones.zones,
      zonesFromAssets: zones.fromAssets,
      powerTotal: power.total,
      powerDevices: power.devices,
      powerBars: power.bars,
      events
    };
  }

  private loadDevices(powerKey: string): Observable<DeviceSummary[]> {
    const latestValues = [{type: EntityKeyType.SERVER_ATTRIBUTE, key: 'active'}];
    if (powerKey) {
      latestValues.push({type: EntityKeyType.TIME_SERIES, key: powerKey});
    }
    const query: EntityDataQuery = {
      entityFilter: {type: AliasFilterType.entityType, entityType: EntityType.DEVICE},
      pageLink: {page: 0, pageSize: DEVICE_LIMIT},
      entityFields: [{type: EntityKeyType.ENTITY_FIELD, key: 'name'}, {type: EntityKeyType.ENTITY_FIELD, key: 'type'}],
      latestValues
    };
    return this.entityService.findEntityDataByQuery(query, quietRequest).pipe(
      map(page => page.data.map(entity => this.toDevice(entity, powerKey))),
      catchError(() => of([]))
    );
  }

  private toDevice(entity: EntityData, powerKey: string): DeviceSummary {
    const fields = entity.latest[EntityKeyType.ENTITY_FIELD] ?? {};
    const power = powerKey ? entity.latest[EntityKeyType.TIME_SERIES]?.[powerKey]?.value : undefined;
    return {
      id: entity.entityId.id,
      entityId: entity.entityId,
      name: fields.name?.value,
      type: fields.type?.value,
      active: entity.latest[EntityKeyType.SERVER_ATTRIBUTE]?.active?.value === 'true',
      power: power !== undefined && power !== '' && !isNaN(Number(power)) ? Number(power) : undefined
    };
  }

  private alarmQuery(pageSize: number, statusList: AlarmSearchStatus[]): AlarmQueryV2 {
    const pageLink = new TimePageLink(pageSize, 0, null, {property: 'createdTime', direction: Direction.DESC});
    return new AlarmQueryV2(null, pageLink, {statusList});
  }

  private loadActiveAlarms(): Observable<AlarmInfo[]> {
    return this.alarmService.getAllAlarmsV2(this.alarmQuery(500, [AlarmSearchStatus.ACTIVE]), quietRequest).pipe(
      map(page => page.data),
      catchError(() => of([]))
    );
  }

  private loadEvents(): Observable<AlarmInfo[]> {
    return this.alarmService.getAllAlarmsV2(this.alarmQuery(8, []), quietRequest).pipe(
      map(page => page.data),
      catchError(() => of([]))
    );
  }

  private loadZones(devices: DeviceSummary[], activeAlarms: AlarmInfo[]): Observable<{zones: Zone[]; fromAssets: boolean}> {
    const byId = new Map(devices.map(d => [d.id, d]));
    const query: EntityDataQuery = {
      entityFilter: {type: AliasFilterType.entityType, entityType: EntityType.ASSET},
      pageLink: {
        page: 0, pageSize: ZONE_LIMIT,
        sortOrder: {key: {type: EntityKeyType.ENTITY_FIELD, key: 'name'}, direction: Direction.ASC}
      },
      entityFields: [{type: EntityKeyType.ENTITY_FIELD, key: 'name'}]
    };
    return this.entityService.findEntityDataByQuery(query, quietRequest).pipe(
      catchError(() => of({data: []} as any)),
      switchMap(page => {
        const assets: EntityData[] = page.data;
        if (!assets.length) {
          return of({zones: this.zonesByProfile(devices, activeAlarms), fromAssets: false});
        }
        return forkJoin(assets.map(asset =>
          this.relationService.findByFrom(asset.entityId, quietRequest).pipe(
            map(relations => relations
              .filter(r => r.type === 'Contains' && r.to.entityType === EntityType.DEVICE)
              .map(r => byId.get(r.to.id))
              .filter(Boolean)),
            catchError(() => of([] as DeviceSummary[])),
            map(zoneDevices => this.toZone(asset.latest[EntityKeyType.ENTITY_FIELD]?.name?.value,
              `/entities/assets/${asset.entityId.id}`, zoneDevices, activeAlarms))
          )
        )).pipe(map(zones => ({zones, fromAssets: true})));
      })
    );
  }

  private zonesByProfile(devices: DeviceSummary[], activeAlarms: AlarmInfo[]): Zone[] {
    const groups = new Map<string, DeviceSummary[]>();
    devices.forEach(d => groups.set(d.type, [...(groups.get(d.type) ?? []), d]));
    return Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, ZONE_LIMIT)
      .map(([type, group]) => this.toZone(type, '/entities/devices', group, activeAlarms));
  }

  private toZone(name: string, link: string, devices: DeviceSummary[], activeAlarms: AlarmInfo[]): Zone {
    const ids = new Set(devices.map(d => d.id));
    const alarms = activeAlarms.filter(a => ids.has(a.originator.id));
    const worst = Math.max(-1, ...alarms.map(a => severityRank[a.severity] ?? 0));
    const online = devices.filter(d => d.active).length;
    let status: ZoneStatus = 'ok';
    if (worst >= severityRank[AlarmSeverity.MAJOR]) {
      status = 'crit';
    } else if (worst >= 0 || online < devices.length) {
      status = 'warn';
    }
    return {name, link, online, total: devices.length, alarms: alarms.length, status};
  }

  private loadPower(devices: DeviceSummary[], key: string): Observable<{bars: PowerBar[]; total: number | null; devices: number}> {
    const powered = devices.filter(d => d.power !== undefined).slice(0, POWER_DEVICE_LIMIT);
    if (!key || !powered.length) {
      return of({bars: [], total: null, devices: 0});
    }
    const endTs = Math.ceil(Date.now() / HOUR_MS) * HOUR_MS;
    const startTs = endTs - HOURS * HOUR_MS;
    return forkJoin(powered.map(device =>
      this.attributeService.getEntityTimeseries(device.entityId, [key], startTs, endTs, HOURS,
        AggregationType.AVG, HOUR_MS, undefined, false, quietRequest).pipe(
        map(series => series?.[key] ?? []),
        catchError(() => of([]))
      )
    )).pipe(
      map(allSeries => {
        const sums = new Array<number>(HOURS).fill(0);
        allSeries.forEach(series => series.forEach(point => {
          const index = Math.floor((point.ts - startTs) / HOUR_MS);
          if (index >= 0 && index < HOURS && !isNaN(Number(point.value))) {
            sums[index] += Number(point.value);
          }
        }));
        const max = Math.max(...sums) || 1;
        const slot = CHART_WIDTH / HOURS;
        const bars = sums.map((sum, i) => {
          const height = Math.max(sum > 0 ? 4 : 2, Math.round((sum / max) * (CHART_HEIGHT - 10)));
          return {
            x: Math.round(i * slot + slot * 0.15),
            y: CHART_HEIGHT - height,
            height,
            current: i === HOURS - 1,
            label: `${new Date(startTs + i * HOUR_MS).getHours().toString().padStart(2, '0')}:00 · ${formatNumber(sum)}`
          };
        });
        return {bars, total: powered.reduce((acc, d) => acc + d.power, 0), devices: powered.length};
      })
    );
  }

  get barWidth(): number {
    return Math.round((CHART_WIDTH / HOURS) * 0.7);
  }

  formatValue(value: number): string {
    return formatNumber(value);
  }

  private loadPowerKey(): string {
    try {
      return localStorage.getItem(POWER_KEY_STORAGE) || 'power';
    } catch {
      return 'power';
    }
  }
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {maximumFractionDigits: value >= 100 ? 0 : 1});
}
