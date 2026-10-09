import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type Database from 'better-sqlite3';
import { closeApp, dbFileOf, launchApp, makeUserDataDir, openDb, readMainLog, removeDir, type Launched } from './fixtures';

/** The desktop capabilities a spec can need unsupported (each can be forced through INFINITY_NOTES_TEST_CAPS). */
export type ForcibleCapability = 'windowPositioning' | 'alwaysOnTop' | 'tray' | 'nativeNotifications';

export interface Harness {
  readonly userData: string;
  readonly page: Page;
  readonly app: ElectronApplication;
  start(extraEnv?: Record<string, string>): Promise<Launched>;
  /** Closes the app (a real quit of the process) and starts it again on the same userData, with these extra variables. */
  restart(extraEnv?: Record<string, string>): Promise<Launched>;
  stop(): Promise<void>;
  /**
   * Starts the app with `capability` unsupported. Where this desktop already reports it unsupported (WSLg has no tray
   * host, notification server, window positioning or pinning), that real detection is kept; elsewhere (Windows, X11)
   * the app is started again with the capability forced through INFINITY_NOTES_TEST_CAPS. `forced` tells which, so a
   * spec can expect the matching reason.
   */
  startUnsupported(capability: ForcibleCapability, extraEnv?: Record<string, string>): Promise<Launched & { forced: boolean }>;
  /** Read-only SQL against the live database file. */
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[];
  one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined;
  /** Read-write access for tests that deliberately age or corrupt data while the app is closed. */
  writeWhileClosed(fn: (db: Database.Database) => void): void;
  setting(key: string): unknown;
}

/**
 * Registers per-test userData and teardown hooks; call at the top level of a spec file. With `failOnMainErrors`,
 * a test fails when main logged an uncaught exception or an unhandled rejection during it.
 */
export function useApp(options: { failOnMainErrors?: boolean } = {}): Harness {
  let userData = '';
  let launched: Launched | null = null;

  test.beforeEach(() => {
    userData = makeUserDataDir();
  });
  test.afterEach(async () => {
    await closeApp(launched?.app);
    launched = null;
    const mainErrors = options.failOnMainErrors ? readMainLog(userData).split('\n').filter((l) => /uncaughtException|unhandledRejection/.test(l)) : [];
    await removeDir(userData);
    expect(mainErrors, 'main process errors in main.log').toEqual([]);
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
    async restart(extraEnv) {
      await closeApp(launched?.app);
      launched = null;
      return h.start(extraEnv);
    },
    async startUnsupported(capability, extraEnv = {}) {
      const natural = await h.start(extraEnv);
      const reported = await natural.page.evaluate(() => window.infinity.capabilities.get());
      if (!reported.ok) throw new Error('capabilities.get failed');
      if (reported.data[capability].status === 'unsupported') return { ...natural, forced: false };
      const caps = { ...(JSON.parse(extraEnv.INFINITY_NOTES_TEST_CAPS ?? '{}') as Record<string, string>), [capability]: 'unsupported' };
      return { ...(await h.restart({ ...extraEnv, INFINITY_NOTES_TEST_CAPS: JSON.stringify(caps) })), forced: true };
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
