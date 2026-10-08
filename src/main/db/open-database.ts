import fs from 'node:fs';
import path from 'node:path';
import type { StartupErrorCodeType } from '../../shared/contracts/app';
import type { Logger } from '../services/logger';
import { nullLogger } from '../services/logger';
import { openBetterSqlite } from './better-sqlite3-driver';
import type { Db, OpenOptions } from './driver';
import { MigrationError, migrateDatabase } from './migrate';
import { MIGRATIONS, type Migration } from './migrations';

export interface DbDiagnostics {
  driver: string;
  sqliteVersion: string;
  fts5: boolean;
  json: boolean;
  schemaVersion: number;
}

export type DbOpenResult =
  | {
      ok: true;
      db: Db;
      schemaVersion: number;
      migratedFrom: number;
      preMigrationCopy: boolean;
      diagnostics: DbDiagnostics;
    }
  | { ok: false; code: StartupErrorCodeType; detail: string };

export interface OpenDatabaseOptions {
  dbFile: string;
  preMigrationDir: string;
  migrations?: readonly Migration[];
  logger?: Logger;
  open?: (file: string, opts: OpenOptions) => Db;
  /** Wall clock for the pre-migration copy name. */
  now?: () => Date;
}

const KEEP_PRE_MIGRATION_COPIES = 3;

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:.]/g, '');
}

function pruneCopies(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^infinity-notes-v\d+-\d{8}T\d+Z\.sqlite3$/.test(f))
    .sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP_PRE_MIGRATION_COPIES))) {
    fs.rmSync(path.join(dir, old), { force: true });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function openDatabase(options: OpenDatabaseOptions): Promise<DbOpenResult> {
  const logger = options.logger ?? nullLogger;
  const migrations = options.migrations ?? MIGRATIONS;
  const open = options.open ?? openBetterSqlite;
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0);
  const { dbFile, preMigrationDir } = options;

  const existed = fs.existsSync(dbFile) && fs.statSync(dbFile).size > 0;
  let existingTables = 0;

  // Read-only probe: nothing is written before the file is known to be a compatible database.
  if (existed) {
    let probe: Db | null = null;
    let existingVersion: number;
    try {
      probe = open(dbFile, { readonly: true, fileMustExist: true });
      existingVersion = Number(probe.pragmaValue('user_version'));
      const row = probe
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .get();
      existingTables = row?.n ?? 0;
    } catch (err) {
      const detail = errorMessage(err);
      logger.error(`db startup error code=DB_OPEN_FAILED detail=${detail}`);
      return { ok: false, code: 'DB_OPEN_FAILED', detail };
    } finally {
      try {
        probe?.close();
      } catch {
        // ignore
      }
    }
    if (existingVersion > latest) {
      const detail = `schema version ${existingVersion} is newer than ${latest}`;
      logger.error(`db startup error code=SCHEMA_TOO_NEW detail=${detail}`);
      return { ok: false, code: 'SCHEMA_TOO_NEW', detail };
    }
  }

  let db: Db;
  try {
    db = open(dbFile, { timeoutMs: 5000 });
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = FULL');
  } catch (err) {
    const detail = errorMessage(err);
    logger.error(`db startup error code=DB_OPEN_FAILED detail=${detail}`);
    return { ok: false, code: 'DB_OPEN_FAILED', detail };
  }

  const current = Number(db.pragmaValue('user_version'));
  let preMigrationCopy = false;
  try {
    if (current < latest) {
      if (existed && existingTables > 0) {
        fs.mkdirSync(preMigrationDir, { recursive: true });
        const copy = path.join(preMigrationDir, `infinity-notes-v${current}-${stamp((options.now ?? (() => new Date()))())}.sqlite3`);
        await db.backup(copy);
        pruneCopies(preMigrationDir);
        preMigrationCopy = true;
      }
      migrateDatabase(db, migrations);
    }
    const mode = String(db.pragmaValue('journal_mode = WAL')).toLowerCase();
    if (mode !== 'wal') throw new Error(`journal_mode is ${mode}, expected wal`);
  } catch (err) {
    const version = err instanceof MigrationError ? err.version : current + 1;
    const detail = errorMessage(err);
    logger.error(`migration failed version=${version} error=${detail}`);
    logger.error(`db startup error code=MIGRATION_FAILED detail=${detail}`);
    try {
      db.close();
    } catch {
      // ignore
    }
    return { ok: false, code: 'MIGRATION_FAILED', detail };
  }

  const schemaVersion = Number(db.pragmaValue('user_version'));
  const compile = db.pragma('compile_options') as Array<{ compile_options: string }>;
  const fts5 = compile.some((r) => r.compile_options === 'ENABLE_FTS5');
  const jsonRow = db.prepare<[], { ok: number }>("SELECT json_valid('{}') AS ok").get();
  const diagnostics: DbDiagnostics = {
    driver: db.driverName,
    sqliteVersion: db.sqliteVersion,
    fts5,
    json: jsonRow?.ok === 1,
    schemaVersion,
  };
  logger.info(
    `db open driver=${db.driverName} sqlite=${db.sqliteVersion} schema=${schemaVersion} migratedFrom=${current} preMigrationCopy=${preMigrationCopy ? 'yes' : 'no'}`,
  );
  return { ok: true, db, schemaVersion, migratedFrom: current, preMigrationCopy, diagnostics };
}
