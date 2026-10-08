import { test, type ElectronApplication, type Page } from '@playwright/test';
import type Database from 'better-sqlite3';
import { closeApp, dbFileOf, launchApp, makeUserDataDir, openDb, removeDir, type Launched } from './fixtures';

export interface Harness {
  readonly userData: string;
  readonly page: Page;
  readonly app: ElectronApplication;
  start(extraEnv?: Record<string, string>): Promise<Launched>;
  /** Closes the app (a real quit of the process) and starts it again on the same userData. */
  restart(): Promise<Launched>;
  stop(): Promise<void>;
  /** Read-only SQL against the live database file. */
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[];
  one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined;
  /** Read-write access for tests that deliberately age or corrupt data while the app is closed. */
  writeWhileClosed(fn: (db: Database.Database) => void): void;
  setting(key: string): unknown;
}

/** Registers per-test userData and teardown hooks; call at the top level of a spec file. */
export function useApp(): Harness {
  let userData = '';
  let launched: Launched | null = null;

  test.beforeEach(() => {
    userData = makeUserDataDir();
  });
  test.afterEach(async () => {
    await closeApp(launched?.app);
    launched = null;
    await removeDir(userData);
  });

  const h: Harness = {
    get userData() {
      return userData;
    },
    get page() {
      if (!launched) throw new Error('app not started');
      return launched.page;
    },
    get app() {
      if (!launched) throw new Error('app not started');
      return launched.app;
    },
    async start(extraEnv) {
      launched = await launchApp({ userDataDir: userData, extraEnv });
      return launched;
    },
    async restart() {
      await closeApp(launched?.app);
      launched = null;
      return h.start();
    },
    async stop() {
      await closeApp(launched?.app);
      launched = null;
    },
    all(sql, ...params) {
      const db = openDb(dbFileOf(userData), { readonly: true });
      try {
        return db.prepare(sql).all(...params) as never;
      } finally {
        db.close();
      }
    },
    one(sql, ...params) {
      return h.all(sql, ...params)[0] as never;
    },
    writeWhileClosed(fn) {
      if (launched) throw new Error('close the app first');
      const db = openDb(dbFileOf(userData));
      try {
        fn(db);
      } finally {
        db.close();
      }
    },
    setting(key) {
      const row = h.one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
      return row ? JSON.parse(row.value) : undefined;
    },
  };
  return h;
}
