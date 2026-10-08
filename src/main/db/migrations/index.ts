import initialSql from './001_initial.sql?raw';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: 'initial', sql: initialSql }];

export const LATEST = MIGRATIONS[MIGRATIONS.length - 1]!.version;
