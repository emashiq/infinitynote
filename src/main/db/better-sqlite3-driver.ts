import Database from 'better-sqlite3';
import type { Db, OpenOptions, Statement } from './driver';

/**
 * The only module that imports better-sqlite3. Typings from @types/better-sqlite3 are
 * confined to this file; the rest of the app depends on the Db interface.
 */
export function openBetterSqlite(file: string, opts: OpenOptions = {}): Db {
  const raw = new Database(file, {
    readonly: opts.readonly ?? false,
    fileMustExist: opts.fileMustExist ?? false,
    timeout: opts.timeoutMs ?? 5000,
  });
  let versionRow: { v: string };
  try {
    versionRow = raw.prepare('SELECT sqlite_version() AS v').get() as { v: string };
  } catch (err) {
    raw.close();
    throw err;
  }

  const db: Db = {
    driverName: 'better-sqlite3',
    sqliteVersion: versionRow.v,
    exec(sql) {
      raw.exec(sql);
    },
    prepare<P extends unknown[] = unknown[], R = unknown>(sql: string): Statement<P, R> {
      const stmt = raw.prepare(sql);
      return {
        run: (...p: P) => {
          const r = stmt.run(...(p as unknown[]));
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
        get: (...p: P) => stmt.get(...(p as unknown[])) as R | undefined,
        all: (...p: P) => stmt.all(...(p as unknown[])) as R[],
      };
    },
    transaction<T>(fn: () => T, mode: 'deferred' | 'immediate' = 'deferred'): T {
      const wrapped = raw.transaction(fn);
      return mode === 'immediate' ? wrapped.immediate() : wrapped.deferred();
    },
    pragma(sql) {
      return raw.pragma(sql) as unknown[];
    },
    pragmaValue(sql) {
      return raw.pragma(sql, { simple: true });
    },
    async backup(destFile) {
      await raw.backup(destFile);
    },
    close() {
      raw.close();
    },
  };
  return db;
}
