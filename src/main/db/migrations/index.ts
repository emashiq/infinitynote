import initialSql from './001_initial.sql?raw';
import hierarchyIndexesSql from './002_hierarchy_indexes.sql?raw';
import trashReanchoredSql from './003_trash_reanchored.sql?raw';
import windowStateSql from './004_window_state.sql?raw';
import remindersSql from './005_reminders.sql?raw';
import reminderSourcesSql from './006_reminder_sources.sql?raw';
import referencesTagsSql from './007_references_tags.sql?raw';
import stickyTextColorSql from './008_sticky_text_color.sql?raw';
import linkedFilesSql from './009_linked_files.sql?raw';
import noteLocksSql from './010_note_locks.sql?raw';
import documentsSql from './011_documents.sql?raw';
import documentReferencesSql from './012_document_references.sql?raw';
import commentsSql from './013_comments.sql?raw';
import stickyPinsSql from './014_sticky_pins.sql?raw';

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
  { version: 8, name: 'sticky_text_color', sql: stickyTextColorSql },
  { version: 9, name: 'linked_files', sql: linkedFilesSql },
  { version: 10, name: 'note_locks', sql: noteLocksSql },
  { version: 11, name: 'documents', sql: documentsSql },
  { version: 12, name: 'document_references', sql: documentReferencesSql },
  { version: 13, name: 'comments', sql: commentsSql },
  { version: 14, name: 'sticky_pins', sql: stickyPinsSql },
];

export const LATEST = MIGRATIONS[MIGRATIONS.length - 1]!.version;
