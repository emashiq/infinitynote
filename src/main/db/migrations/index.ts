import initialSql from './001_initial.sql?raw';
import hierarchyIndexesSql from './002_hierarchy_indexes.sql?raw';
import trashReanchoredSql from './003_trash_reanchored.sql?raw';
import windowStateSql from './004_window_state.sql?raw';
import remindersSql from './005_reminders.sql?raw';
import reminderSourcesSql from './006_reminder_sources.sql?raw';
import referencesTagsSql from './007_references_tags.sql?raw';

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
  { version: 5, name: 'reminders', sql: remindersSql },
  { version: 6, name: 'reminder_sources', sql: reminderSourcesSql },
  { version: 7, name: 'references_tags', sql: referencesTagsSql },
];

export const LATEST = MIGRATIONS[MIGRATIONS.length - 1]!.version;
