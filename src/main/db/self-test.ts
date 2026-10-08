import fs from 'node:fs';
import path from 'node:path';
import { errorMessage } from '../services/app-error';
import { openBetterSqlite } from './better-sqlite3-driver';
import type { Db } from './driver';
import { openDatabase } from './open-database';
import { LATEST } from './migrations';

export interface SelfTestRuntime {
  electron?: string;
  node: string;
  modules: string;
  napi: string;
  platform: string;
  arch: string;
  isPackaged?: boolean;
}

export interface SelfTestReport {
  ok: boolean;
  driver: string;
  sqliteVersion: string;
  runtime: SelfTestRuntime;
  loadedBinary?: string;
  checks: Record<string, boolean>;
  errors: string[];
}

export interface SelfTestOptions {
  runtime: SelfTestRuntime;
  resolveBinary?: () => string;
}

const CHECK_NAMES = [
  'sqliteAtLeast3_45',
  'walMode',
  'compileOptionFts5',
  'json',
  'ftsCategoriesTokenizer',
  'ftsBanglaMatch',
  'ftsPrefixMatch',
  'blobRoundTrip',
  'backupApi',
  'migrationsToLatest',
  'docKeyStableAfterVacuum',
  'ftsIntegrity',
] as const;

function versionAtLeast(v: string, major: number, minor: number): boolean {
  const [a, b] = v.split('.').map((n) => Number(n));
  return (a ?? 0) > major || ((a ?? 0) === major && (b ?? 0) >= minor);
}

function note(db: Db, id: string, title: string, body: string): number {
  const r = db
    .prepare<[string, string, string, string]>(
      "INSERT INTO notes(id, title, format, content_text, plain_text, created_at, updated_at) VALUES (?, ?, 'plain', ?, ?, 1, 1)",
    )
    .run(id, title, body, body);
  return Number(r.lastInsertRowid);
}

function ftsRows(db: Db, query: string): number[] {
  return db
    .prepare<[string], { rowid: number }>('SELECT rowid FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rowid')
    .all(query)
    .map((r) => r.rowid);
}

export async function runSqliteSelfTest(tmpDir: string, opts: SelfTestOptions): Promise<SelfTestReport> {
  const checks: Record<string, boolean> = Object.fromEntries(CHECK_NAMES.map((n) => [n, false]));
  const errors: string[] = [];
  const report: SelfTestReport = {
    ok: false,
    driver: 'better-sqlite3',
    sqliteVersion: '',
    runtime: opts.runtime,
    checks,
    errors,
  };
  const attempt = async (name: (typeof CHECK_NAMES)[number], fn: () => boolean | Promise<boolean>) => {
    try {
      checks[name] = Boolean(await fn());
    } catch (err) {
      checks[name] = false;
      errors.push(`${name}: ${errorMessage(err)}`);
    }
  };

  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    if (opts.resolveBinary) report.loadedBinary = opts.resolveBinary();
  } catch (err) {
    errors.push(`resolveBinary: ${errorMessage(err)}`);
  }

  let raw: Db | null = null;
  try {
    raw = openBetterSqlite(path.join(tmpDir, 'raw.sqlite3'));
    report.sqliteVersion = raw.sqliteVersion;
    report.driver = raw.driverName;
  } catch (err) {
    errors.push(`open: ${errorMessage(err)}`);
  }

  if (raw) {
    const db = raw;
    await attempt('sqliteAtLeast3_45', () => versionAtLeast(db.sqliteVersion, 3, 45));
    await attempt('walMode', () => String(db.pragmaValue('journal_mode = WAL')).toLowerCase() === 'wal');
    await attempt('compileOptionFts5', () =>
      (db.pragma('compile_options') as Array<{ compile_options: string }>).some((r) => r.compile_options === 'ENABLE_FTS5'),
    );
    await attempt('json', () => db.prepare<[], { ok: number }>("SELECT json_valid('{\"a\":1}') AS ok").get()?.ok === 1);
    await attempt('ftsCategoriesTokenizer', () => {
      db.exec(
        `CREATE VIRTUAL TABLE tk USING fts5(body, tokenize = "unicode61 remove_diacritics 2 categories 'L* N* Co M*'")`,
      );
      return true;
    });
    await attempt('ftsBanglaMatch', () => {
      db.exec("INSERT INTO tk(rowid, body) VALUES (1, 'আমি বাংলায় লিখি'), (2, 'hello world')");
      return db.prepare<[string], { rowid: number }>('SELECT rowid FROM tk WHERE tk MATCH ?').all('বাংলায়').map((r) => r.rowid).join() === '1';
    });
    await attempt('ftsPrefixMatch', () =>
      db.prepare<[string], { rowid: number }>('SELECT rowid FROM tk WHERE tk MATCH ?').all('hel*').map((r) => r.rowid).join() === '2',
    );
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    await attempt('blobRoundTrip', () => {
      db.exec('CREATE TABLE blobs(id INTEGER PRIMARY KEY, b BLOB)');
      db.prepare<[Buffer]>('INSERT INTO blobs(id, b) VALUES (1, ?)').run(bytes);
      const row = db.prepare<[], { b: Buffer }>('SELECT b FROM blobs WHERE id = 1').get();
      return !!row && Buffer.compare(Buffer.from(row.b), bytes) === 0;
    });
    await attempt('backupApi', async () => {
      const dest = path.join(tmpDir, 'backup.sqlite3');
      await db.backup(dest);
      const copy = openBetterSqlite(dest, { readonly: true, fileMustExist: true });
      try {
        const row = copy.prepare<[], { b: Buffer }>('SELECT b FROM blobs WHERE id = 1').get();
        return !!row && Buffer.compare(Buffer.from(row.b), bytes) === 0;
      } finally {
        copy.close();
      }
    });
    db.close();
  }

  // Migration, doc_key stability and FTS integrity run on a fresh migrated database.
  const migDir = path.join(tmpDir, 'migrated');
  fs.mkdirSync(migDir, { recursive: true });
  const opened = await openDatabase({
    dbFile: path.join(migDir, 'infinity-notes.sqlite3'),
    preMigrationDir: path.join(migDir, 'pre-migration'),
  });
  if (!opened.ok) {
    errors.push(`openDatabase: ${opened.code} ${opened.detail}`);
  } else {
    const db = opened.db;
    await attempt('migrationsToLatest', () => opened.schemaVersion === LATEST);
    await attempt('docKeyStableAfterVacuum', () => {
      const a = '11111111-1111-4111-8111-111111111111';
      const b = '22222222-2222-4222-8222-222222222222';
      note(db, a, 'first', 'alpha body');
      const keyB = note(db, b, 'second', 'bravo বাংলায় body');
      db.prepare<[string]>('DELETE FROM notes WHERE id = ?').run(a);
      db.exec('VACUUM');
      const after = db.prepare<[string], { doc_key: number }>('SELECT doc_key FROM notes WHERE id = ?').get(b);
      return after?.doc_key === keyB && ftsRows(db, 'bravo').join() === String(keyB);
    });
    await attempt('ftsIntegrity', () => {
      db.exec("INSERT INTO notes_fts(notes_fts) VALUES('integrity-check')");
      return true;
    });
    db.close();
  }

  report.ok = errors.length === 0 && CHECK_NAMES.every((n) => checks[n] === true);
  return report;
}
