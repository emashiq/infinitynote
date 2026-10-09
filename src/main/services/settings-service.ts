import {
  SETTINGS,
  settingValueProblem,
  type PublicSettingKey,
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

const isKey = (key: string): key is SettingKey => Object.prototype.hasOwnProperty.call(SETTINGS, key);
const isPublic = (key: string): key is PublicSettingKey => isKey(key) && SETTINGS[key].public;

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
        if (result.success && settingValueProblem(key, result.data) === null) return result.data as SettingValue<K>;
      }
    } catch {
      // fall through to the default
    }
    this.deps.logger.warn(`settings: invalid stored value key=${key}`);
    return entry.default as SettingValue<K>;
  }

  private write(key: SettingKey, value: unknown): SettingsChangedPayload {
    const entry = SETTINGS[key];
    const parsed = entry.schema.safeParse(value);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'Invalid value for setting');
    const problem = settingValueProblem(key, parsed.data);
    if (problem) throw new AppError('VALIDATION_FAILED', problem);
    const updatedAt = this.deps.clock.now();
    this.deps.repo.upsert(key, JSON.stringify({ v: entry.version, value: parsed.data }), updatedAt);
    return { key: key as PublicSettingKey, value: parsed.data, updatedAt };
  }

  /** Public read used by the settings:get channel. Internal keys are refused. */
  get(keys: readonly string[]): Partial<{ [K in PublicSettingKey]: SettingValue<K> }> {
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      if (!isPublic(key)) throw new AppError('VALIDATION_FAILED', 'Unknown setting');
      values[key] = this.readOne(key);
    }
    return values as Partial<{ [K in PublicSettingKey]: SettingValue<K> }>;
  }

  /** Public write used by the settings:set channel; broadcasts settings:changed. */
  set(key: string, value: unknown): SettingsChangedPayload {
    if (!isPublic(key)) throw new AppError('VALIDATION_FAILED', 'Unknown setting');
    const payload = this.write(key, value);
    this.deps.emit(payload);
    return payload;
  }

  /** Main-process read of any registry key, including internal ones. */
  getInternal<K extends SettingKey>(key: K): SettingValue<K> {
    return this.readOne(key);
  }

  /** Main-process write of any registry key. Never emits settings:changed. */
  setInternal(key: SettingKey, value: unknown): void {
    this.write(key, value);
  }
}
