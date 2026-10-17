// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges
} from '@angular/core';
import { forkJoin, interval, Observable, of, Subject, Subscription } from 'rxjs';
import { catchError, map, switchMap, takeUntil } from 'rxjs/operators';
import { AttributeService } from '@core/http/attribute.service';
import { AttributeScope, DataSortOrder } from '@shared/models/telemetry/telemetry.models';
import { AggregationType } from '@shared/models/time/time.models';
import { BaseData, HasId } from '@shared/models/base-data';
import { DeviceInfo } from '@shared/models/device.models';
import { CellActionDescriptor } from '@home/models/entity/entities-table-config.models';
import { EntityId } from '@shared/models/id/entity-id';

interface TileReading {
  key: string;
  value: string;
}

interface TileTelemetry {
  lastActivityTime?: number;
  readings: TileReading[];
  sparkline?: string;
  sparkArea?: string;
}

export interface EntityTileClick {
  event: Event;
  entity: BaseData<HasId>;
}

const SPARK_WIDTH = 200;
const SPARK_HEIGHT = 40;
const SPARK_WINDOW_MS = 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 30000;
const quietRequest = {ignoreLoading: true, ignoreErrors: true};

@Component({
  selector: 'tb-entity-tiles',
  templateUrl: './entity-tiles.component.html',
  styleUrls: ['./entity-tiles.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EntityTilesComponent implements OnChanges, OnDestroy {

  @Input() entities: Array<BaseData<HasId>> = [];
  @Input() cellActionDescriptors: Array<CellActionDescriptor<BaseData<HasId>>> = [];
  @Input() isCurrentEntity: (entity: BaseData<HasId>) => boolean = () => false;
  @Input() disabled = false;

  @Output() tileClick = new EventEmitter<EntityTileClick>();

  telemetry = new Map<string, TileTelemetry>();
  now = Date.now();

  private refresh$ = new Subject<void>();
  private destroy$ = new Subject<void>();
  private loadSubscription: Subscription;

  constructor(private attributeService: AttributeService,
              private cd: ChangeDetectorRef) {
    interval(REFRESH_INTERVAL_MS).pipe(takeUntil(this.destroy$)).subscribe(() => this.refresh$.next());
    this.refresh$.pipe(takeUntil(this.destroy$)).subscribe(() => this.loadTelemetry());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.entities) {
      this.loadTelemetry();
    }
  }

  ngOnDestroy(): void {
    this.loadSubscription?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
  }

  trackById(_index: number, entity: BaseData<HasId>): string {
    return entity.id.id;
  }

  asDevice(entity: BaseData<HasId>): DeviceInfo {
    return entity as DeviceInfo;
  }

  telemetryOf(entity: BaseData<HasId>): TileTelemetry {
    return this.telemetry.get(entity.id.id);
  }

  lastSeen(entity: BaseData<HasId>): string {
    const ts = this.telemetryOf(entity)?.lastActivityTime;
    if (!ts) {
      return '';
    }
    const seconds = Math.max(0, Math.round((this.now - ts) / 1000));
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 48) {
      return `${hours}h`;
    }
    return `${Math.round(hours / 24)}d`;
  }

  onTileClick(event: Event, entity: BaseData<HasId>) {
    if (!this.disabled) {
      this.tileClick.emit({event, entity});
    }
  }

  private loadTelemetry() {
    this.loadSubscription?.unsubscribe();
    const entities = this.entities ?? [];
    if (!entities.length) {
      return;
    }
    this.loadSubscription = forkJoin(
      entities.map(entity => this.loadEntityTelemetry(entity.id as EntityId).pipe(
        map(telemetry => [entity.id.id, telemetry] as [string, TileTelemetry])
      ))
    ).subscribe(results => {
      this.now = Date.now();
      this.telemetry = new Map(results);
      this.cd.markForCheck();
    });
  }

  private loadEntityTelemetry(entityId: EntityId): Observable<TileTelemetry> {
    const activity$ = this.attributeService.getEntityAttributes(entityId, AttributeScope.SERVER_SCOPE,
      ['lastActivityTime'], quietRequest).pipe(
      map(attributes => Number(attributes?.[0]?.value) || undefined),
      catchError(() => of(undefined))
    );
    const latest$ = this.attributeService.getEntityTimeseriesLatest(entityId, undefined, false, quietRequest).pipe(
      catchError(() => of({}))
    );
    return forkJoin([activity$, latest$]).pipe(
      switchMap(([lastActivityTime, latest]) => {
        const readings: TileReading[] = Object.keys(latest ?? {})
          .map(key => ({key, value: latest[key]?.[0]?.value, ts: latest[key]?.[0]?.ts}))
          .filter(reading => reading.value !== undefined && reading.value !== null)
          .sort((a, b) => Number(isNumeric(b.value)) - Number(isNumeric(a.value)) || (b.ts ?? 0) - (a.ts ?? 0))
          .slice(0, 2)
          .map(reading => ({key: reading.key, value: formatValue(reading.value)}));
        const lastTs = Math.max(lastActivityTime ?? 0, ...Object.values(latest ?? {}).map(values => values?.[0]?.ts ?? 0));
        const telemetry: TileTelemetry = {lastActivityTime: lastTs || undefined, readings};
        const primary = readings[0];
        if (!primary || !isNumeric(latest[primary.key][0].value)) {
          return of(telemetry);
        }
        const endTs = Date.now();
        return this.attributeService.getEntityTimeseries(entityId, [primary.key], endTs - SPARK_WINDOW_MS, endTs,
          60, AggregationType.NONE, undefined, DataSortOrder.ASC, false, quietRequest).pipe(
          map(history => ({...telemetry, ...sparkline((history?.[primary.key] ?? []).map(v => Number(v.value)))})),
          catchError(() => of(telemetry))
        );
      })
    );
  }
}

function isNumeric(value: unknown): boolean {
  return value !== '' && value !== null && !isNaN(Number(value));
}

function formatValue(value: string): string {
  if (!isNumeric(value)) {
    return String(value).length > 18 ? String(value).substring(0, 17) + '…' : String(value);
  }
  const num = Number(value);
  return Number.isInteger(num) ? num.toLocaleString() : num.toLocaleString(undefined, {maximumFractionDigits: 2});
}

function sparkline(values: number[]): Pick<TileTelemetry, 'sparkline' | 'sparkArea'> {
  if (values.length < 2) {
    return {};
  }
  const min = Math.min(...values);
  const range = (Math.max(...values) - min) || 1;
  const step = SPARK_WIDTH / (values.length - 1);
  const points = values.map((v, i) =>
    `${(i * step).toFixed(1)} ${(SPARK_HEIGHT - 4 - ((v - min) / range) * (SPARK_HEIGHT - 8)).toFixed(1)}`);
  const line = 'M' + points.join(' L');
  return {sparkline: line, sparkArea: `${line} L${SPARK_WIDTH} ${SPARK_HEIGHT} L0 ${SPARK_HEIGHT} Z`};
}
