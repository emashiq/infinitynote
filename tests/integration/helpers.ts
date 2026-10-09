import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import type { Db } from '../../src/main/db/driver';
import { openDatabase, type DbOpenResult } from '../../src/main/db/open-database';
import type { Clock } from '../../src/main/services/clock';
import type { IdGenerator } from '../../src/main/services/ids';
import { memoryLogger } from '../../src/main/services/logger';

const tmpDirs: string[] = [];
const openDbs: Db[] = [];

export function mkTmp(prefix = 'infinity-it-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

export function trackDb<T extends Db>(db: T): T {
  openDbs.push(db);
  return db;
}

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

export function fixedClock(start = 1_700_000_000_000): Clock & { advance(ms: number): void; set(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    monotonicNow: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
}

export function randomIds(): IdGenerator {
  return { uuid: () => randomUUID() };
}

export interface TestDb {
  dir: string;
  dbFile: string;
  preMigrationDir: string;
  db: Db;
  logger: ReturnType<typeof memoryLogger>;
}

/** Closes a test database and opens the same file again, as an app restart does. */
export async function reopen(t: TestDb): Promise<TestDb> {
  t.db.close();
  const logger = memoryLogger();
  const result = await openDatabase({ dbFile: t.dbFile, preMigrationDir: t.preMigrationDir, logger });
  if (!result.ok) throw new Error(`reopen failed: ${result.code} ${result.detail}`);
  return { ...t, db: trackDb(result.db), logger };
}

export async function openFresh(): Promise<TestDb> {
  const dir = mkTmp();
  const dbFile = path.join(dir, 'data', 'infinity-notes.sqlite3');
  const preMigrationDir = path.join(dir, 'data', 'pre-migration');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const logger = memoryLogger();
  const result: DbOpenResult = await openDatabase({ dbFile, preMigrationDir, logger });
  if (!result.ok) throw new Error(`open failed: ${result.code} ${result.detail}`);
  return { dir, dbFile, preMigrationDir, db: trackDb(result.db), logger };
}
