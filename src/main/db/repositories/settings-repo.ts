import type { Db } from '../driver';

export interface SettingRow {
  key: string;
  value: string;
  updated_at: number;
}

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  getRow(key: string): SettingRow | undefined {
    return this.db
      .prepare<[string], SettingRow>('SELECT key, value, updated_at FROM settings WHERE key = ?')
      .get(key);
  }

  upsert(key: string, jsonValue: string, updatedAt: number): void {
    this.db
      .prepare<[string, string, number]>(
        'INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(key, jsonValue, updatedAt);
  }
}
