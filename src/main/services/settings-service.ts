import {
  SETTINGS,
  type SettingKey,
  type SettingValue,
  type SettingsChangedPayload,
} from '../../shared/contracts/settings';
import type { SettingsRepo } from '../db/repositories/settings-repo';
import { AppError } from './app-error';
import type { Clock } from './clock';
import type { Logger } from './logger';

export interface SettingsServiceDeps {
  repo: SettingsRepo;
  clock: Clock;
  logger: Logger;
  emit: (payload: SettingsChangedPayload) => void;
}

export class SettingsService {
  constructor(private readonly deps: SettingsServiceDeps) {}

  private readOne<K extends SettingKey>(key: K): SettingValue<K> {
    const entry = SETTINGS[key];
    const row = this.deps.repo.getRow(key);
    if (!row) return entry.default as SettingValue<K>;
    try {
      const parsed: unknown = JSON.parse(row.value);
      if (parsed !== null && typeof parsed === 'object' && (parsed as { v?: unknown }).v === entry.version) {
        const result = entry.schema.safeParse((parsed as { value?: unknown }).value);
        if (result.success) return result.data as SettingValue<K>;
      }
    } catch {
      // fall through to the default
    }
    this.deps.logger.warn(`settings: invalid stored value key=${key}`);
    return entry.default as SettingValue<K>;
  }

  get(keys: readonly SettingKey[]): Partial<{ [K in SettingKey]: SettingValue<K> }> {
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(SETTINGS, key)) {
        throw new AppError('VALIDATION_FAILED', 'Unknown setting');
      }
      values[key] = this.readOne(key);
    }
    return values as Partial<{ [K in SettingKey]: SettingValue<K> }>;
  }

  set(key: string, value: unknown): SettingsChangedPayload {
    if (!Object.prototype.hasOwnProperty.call(SETTINGS, key)) {
      throw new AppError('VALIDATION_FAILED', 'Unknown setting');
    }
    const entry = SETTINGS[key as SettingKey];
    const parsed = entry.schema.safeParse(value);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'Invalid value for setting');
    const updatedAt = this.deps.clock.now();
    this.deps.repo.upsert(key, JSON.stringify({ v: entry.version, value: parsed.data }), updatedAt);
    const payload: SettingsChangedPayload = { key: key as SettingKey, value: parsed.data, updatedAt };
    this.deps.emit(payload);
    return payload;
  }
}
