import { errorMessage } from '../services/app-error';
import type { Db } from './driver';
import type { Migration } from './migrations';

export class MigrationError extends Error {
  readonly version: number;

  constructor(version: number, message: string) {
    super(message);
    this.name = 'MigrationError';
    this.version = version;
  }
}

/**
 * Applies every pending migration in a single IMMEDIATE transaction together with the
 * user_version bump. Any failure rolls the whole step back and throws MigrationError.
 */
export function migrateDatabase(db: Db, migrations: readonly Migration[]): { from: number; to: number } {
  const from = Number(db.pragmaValue('user_version'));
  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return { from, to: from };
  let current = from;
  try {
    db.transaction(() => {
      for (const m of pending) {
        current = m.version;
        db.exec(m.sql);
        db.pragma(`user_version = ${m.version}`);
        const violations = db.pragma('foreign_key_check');
        if (violations.length > 0) {
          throw new Error(`foreign key violations after migration ${m.version}`);
        }
      }
    }, 'immediate');
  } catch (err) {
    throw new MigrationError(current, errorMessage(err));
  }
  return { from, to: pending[pending.length - 1]!.version };
}
