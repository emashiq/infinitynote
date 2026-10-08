import initialSql from './001_initial.sql?raw';
import hierarchyIndexesSql from './002_hierarchy_indexes.sql?raw';
import trashReanchoredSql from './003_trash_reanchored.sql?raw';
import windowStateSql from './004_window_state.sql?raw';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: initialSql },
  { version: 2, name: 'hierarchy_indexes', sql: hierarchyIndexesSql },
  { version: 3, name: 'trash_reanchored', sql: trashReanchoredSql },
  { version: 4, name: 'window_state', sql: windowStateSql },
];

export const LATEST = MIGRATIONS[MIGRATIONS.length - 1]!.version;
