import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openBetterSqlite } from '../../src/main/db/better-sqlite3-driver';
import type { Db } from '../../src/main/db/driver';
import { MigrationError, migrateDatabase } from '../../src/main/db/migrate';
import { LATEST, MIGRATIONS, type Migration } from '../../src/main/db/migrations';
import { openDatabase } from '../../src/main/db/open-database';
import { memoryLogger } from '../../src/main/services/logger';
import { mkTmp, openFresh, trackDb } from './helpers';

const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function layout() {
  const dir = mkTmp();
  const dbFile = path.join(dir, 'data', 'infinity-notes.sqlite3');
  const preMigrationDir = path.join(dir, 'data', 'pre-migration');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  return { dir, dbFile, preMigrationDir };
}

function insertNote(db: Db, title: string, body: string, opts: { id?: string; format?: 'plain' | 'rich' } = {}): number {
  const id = opts.id ?? randomUUID();
  const r =
    (opts.format ?? 'plain') === 'plain'
      ? db
          .prepare<[string, string, string, string]>(
            "INSERT INTO notes(id, title, format, content_text, plain_text, created_at, updated_at) VALUES (?, ?, 'plain', ?, ?, 1, 1)",
          )
          .run(id, title, body, body)
      : db
          .prepare<[string, string, string]>(
            "INSERT INTO notes(id, title, format, content_json, plain_text, created_at, updated_at) VALUES (?, ?, 'rich', '{\"type\":\"doc\"}', ?, 1, 1)",
          )
          .run(id, title, body);
  return Number(r.lastInsertRowid);
}

const match = (db: Db, q: string) =>
  db.prepare<[string], { rowid: number }>('SELECT rowid FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rowid').all(q).map((r) => r.rowid);

function tableNames(db: Db): string[] {
  return db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name);
}

let tick = 0;
const uniqueNow = () => new Date(Date.UTC(2026, 9, 8, 12, 0, 0) + 1000 * tick++);

describe('migrations (INF-FND-05)', () => {
  it('fresh: the latest schema, wal, foreign keys and synchronous FULL', async () => {
    const t = await openFresh();
    expect(t.db.pragmaValue('user_version')).toBe(LATEST);
    expect(String(t.db.pragmaValue('journal_mode')).toLowerCase()).toBe('wal');
    expect(t.db.pragmaValue('foreign_keys')).toBe(1);
    expect(t.db.pragmaValue('synchronous')).toBe(2);
    expect(tableNames(t.db)).toEqual(
      expect.arrayContaining([
        'settings', 'projects', 'folders', 'notes', 'trash_reanchored', 'window_state', 'notes_fts', 'note_versions', 'note_drafts', 'attachments', 'note_attachments',
        'reminders', 'occurrences', 'alert_deliveries', 'reminder_sources', 'suggestion_dismissals', 'note_references', 'tags', 'note_tags',
      ]),
    );
    expect(fs.existsSync(t.preMigrationDir) ? fs.readdirSync(t.preMigrationDir) : []).toEqual([]);
    expect(t.logger.lines.some((l) => l.includes('db open driver=better-sqlite3') && l.includes(`schema=${LATEST}`) && l.includes('preMigrationCopy=no'))).toBe(true);
  });

  it('reopening a database at the latest schema makes no pre-migration copy and no change', async () => {
    const t = await openFresh();
    t.db.close();
    const again = await openDatabase({ dbFile: t.dbFile, preMigrationDir: t.preMigrationDir });
    if (!again.ok) throw new Error('reopen failed');
    trackDb(again.db);
    expect(again.migratedFrom).toBe(LATEST);
    expect(again.preMigrationCopy).toBe(false);
    expect(fs.existsSync(t.preMigrationDir) ? fs.readdirSync(t.preMigrationDir) : []).toEqual([]);
  });

  it('failure rolls back: legacy rollback-journal database is untouched, copy is kept', async () => {
    const { dbFile, preMigrationDir } = layout();
    const legacy = openBetterSqlite(dbFile);
    legacy.exec("CREATE TABLE notes(legacy TEXT); INSERT INTO notes(legacy) VALUES ('keep me')");
    legacy.close();
    const before = sha(dbFile);
    const logger = memoryLogger();
    const result = await openDatabase({ dbFile, preMigrationDir, logger });
    expect(result).toMatchObject({ ok: false, code: 'MIGRATION_FAILED' });
    expect(sha(dbFile)).toBe(before);
    const check = trackDb(openBetterSqlite(dbFile, { readonly: true, fileMustExist: true }));
    expect(check.pragmaValue('user_version')).toBe(0);
    expect(tableNames(check)).toEqual(['notes']);
    expect(check.prepare<[], { legacy: string }>('SELECT legacy FROM notes').all()).toEqual([{ legacy: 'keep me' }]);
    const copies = fs.readdirSync(preMigrationDir);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^infinity-notes-v0-\d{8}T\d+Z\.sqlite3$/);
    const copy = trackDb(openBetterSqlite(path.join(preMigrationDir, copies[0]!), { readonly: true, fileMustExist: true }));
    expect(copy.prepare<[], { legacy: string }>('SELECT legacy FROM notes').all()).toEqual([{ legacy: 'keep me' }]);
    expect(logger.lines.some((l) => l.includes('migration failed version=1'))).toBe(true);
  });

  it('newer schema refused unchanged: no wal file and no pre-migration copy', async () => {
    const { dbFile, preMigrationDir } = layout();
    const future = openBetterSqlite(dbFile);
    future.exec('CREATE TABLE future(a TEXT)');
    future.pragma('user_version = 99');
    future.close();
    const before = sha(dbFile);
    const result = await openDatabase({ dbFile, preMigrationDir });
    expect(result).toMatchObject({ ok: false, code: 'SCHEMA_TOO_NEW' });
    expect(sha(dbFile)).toBe(before);
    expect(fs.existsSync(dbFile + '-wal')).toBe(false);
    expect(fs.existsSync(preMigrationDir) ? fs.readdirSync(preMigrationDir) : []).toEqual([]);
  });

  it('unreadable database gives DB_OPEN_FAILED and bytes are unchanged', async () => {
    const { dbFile, preMigrationDir } = layout();
    fs.writeFileSync(dbFile, randomBytes(4096));
    const before = sha(dbFile);
    const result = await openDatabase({ dbFile, preMigrationDir });
    expect(result).toMatchObject({ ok: false, code: 'DB_OPEN_FAILED' });
    expect(sha(dbFile)).toBe(before);
    expect(fs.existsSync(dbFile + '-wal')).toBe(false);
  });

  const failing: Migration = {
    version: LATEST + 1,
    name: 'broken',
    sql: 'CREATE TABLE part_two(a TEXT); CREATE TABLE part_three(a TEXT); THIS IS NOT SQL;',
  };

  it('conflict leaves no partial schema and keeps a pre-migration copy', async () => {
    const t = await openFresh();
    t.db.close();
    const logger = memoryLogger();
    const result = await openDatabase({
      dbFile: t.dbFile,
      preMigrationDir: t.preMigrationDir,
      migrations: [...MIGRATIONS, failing],
      logger,
      now: uniqueNow,
    });
    expect(result).toMatchObject({ ok: false, code: 'MIGRATION_FAILED' });
    const check = trackDb(openBetterSqlite(t.dbFile, { readonly: true, fileMustExist: true }));
    expect(check.pragmaValue('user_version')).toBe(LATEST);
    expect(tableNames(check)).not.toContain('part_two');
    expect(tableNames(check)).not.toContain('part_three');
    expect(fs.readdirSync(t.preMigrationDir)).toHaveLength(1);
    expect(logger.lines.some((l) => l.includes(`migration failed version=${LATEST + 1}`))).toBe(true);
  });

  it('migrateDatabase throws MigrationError carrying the failing version', async () => {
    const t = await openFresh();
    expect(() => migrateDatabase(t.db, [...MIGRATIONS, failing])).toThrow(MigrationError);
    try {
      migrateDatabase(t.db, [...MIGRATIONS, failing]);
    } catch (err) {
      expect((err as MigrationError).version).toBe(LATEST + 1);
    }
    expect(t.db.pragmaValue('user_version')).toBe(LATEST);
  });

  it('foreign key violation rolls back', async () => {
    const t = await openFresh();
    const violating: Migration = {
      version: LATEST + 1,
      name: 'fk',
      sql:
        'PRAGMA defer_foreign_keys = ON;' +
        ` INSERT INTO notes(id, project_id, format, content_text, created_at, updated_at) VALUES ('${randomUUID()}', '${randomUUID()}', 'plain', '', 1, 1);`,
    };
    expect(() => migrateDatabase(t.db, [...MIGRATIONS, violating])).toThrow(MigrationError);
    expect(t.db.pragmaValue('user_version')).toBe(LATEST);
    expect(t.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM notes').get()?.n).toBe(0);
  });

  it('pre-migration retention keeps the newest 3 copies', async () => {
    const t = await openFresh();
    t.db.close();
    for (let i = 0; i < 4; i += 1) {
      const r = await openDatabase({
        dbFile: t.dbFile,
        preMigrationDir: t.preMigrationDir,
        migrations: [...MIGRATIONS, failing],
        now: uniqueNow,
      });
      expect(r.ok).toBe(false);
    }
    expect(fs.readdirSync(t.preMigrationDir)).toHaveLength(3);
  });
});

describe('schema behavior', () => {
  it('fts triggers: insert, title update, soft delete, restore, hard delete, Bangla', async () => {
    const { db } = await openFresh();
    const key = insertNote(db, 'Groceries', 'apples and oranges বাংলায় লিখা');
    expect(match(db, 'apples')).toEqual([key]);
    expect(match(db, 'groceries')).toEqual([key]);
    expect(match(db, 'বাংলায়')).toEqual([key]);
    expect(match(db, 'orang*')).toEqual([key]);

    db.prepare<[string, number]>('UPDATE notes SET title = ? WHERE doc_key = ?').run('Errands', key);
    expect(match(db, 'groceries')).toEqual([]);
    expect(match(db, 'errands')).toEqual([key]);

    db.prepare<[number, number]>('UPDATE notes SET deleted_at = ? WHERE doc_key = ?').run(5, key);
    expect(match(db, 'errands')).toEqual([]);
    expect(match(db, 'apples')).toEqual([]);

    db.prepare<[number]>('UPDATE notes SET deleted_at = NULL WHERE doc_key = ?').run(key);
    expect(match(db, 'errands')).toEqual([key]);

    // revision-only update does not disturb the index
    db.prepare<[number]>('UPDATE notes SET revision = revision + 1 WHERE doc_key = ?').run(key);
    expect(match(db, 'errands')).toEqual([key]);

    db.prepare<[number]>('DELETE FROM notes WHERE doc_key = ?').run(key);
    expect(match(db, 'errands')).toEqual([]);
    db.exec("INSERT INTO notes_fts(notes_fts) VALUES('integrity-check')");
  });

  it('fts doc_key survives VACUUM', async () => {
    const { db } = await openFresh();
    const a = insertNote(db, 'first', 'alpha');
    const b = insertNote(db, 'second', 'bravo বাংলায়');
    expect(b).toBeGreaterThan(a);
    db.prepare<[number]>('DELETE FROM notes WHERE doc_key = ?').run(a);
    db.exec('VACUUM');
    const row = db.prepare<[number], { doc_key: number }>('SELECT doc_key FROM notes WHERE doc_key = ?').get(b);
    expect(row?.doc_key).toBe(b);
    expect(match(db, 'bravo')).toEqual([b]);
    expect(match(db, 'বাংলায়')).toEqual([b]);
    db.exec("INSERT INTO notes_fts(notes_fts) VALUES('integrity-check')");
  });

  it('CHECK constraints reject traversal paths, mixed content and non-JSON settings', async () => {
    const { db } = await openFresh();
    const attach = (p: string) =>
      db
        .prepare<[string, string, string]>(
          "INSERT INTO attachments(id, managed_relative_path, sha256, mime, size_bytes, kind, created_at) VALUES (?, ?, ?, 'image/png', 1, 'image', 1)",
        )
        .run(randomUUID(), p, randomBytes(32).toString('hex'));
    expect(() => attach('attachments/ab/../../x')).toThrow();
    expect(() => attach('attachments/ab\\evil')).toThrow();
    expect(() => attach('other/ab/file')).toThrow();
    expect(() => attach('attachments/ab/file.png')).not.toThrow();

    expect(() =>
      db
        .prepare<[string]>(
          "INSERT INTO notes(id, format, content_json, content_text, created_at, updated_at) VALUES (?, 'rich', '{}', 'x', 1, 1)",
        )
        .run(randomUUID()),
    ).toThrow();
    expect(() =>
      db.prepare("INSERT INTO settings(key, value, updated_at) VALUES ('k', 'not json', 1)").run(),
    ).toThrow();
  });

  it('duplicate note_attachments are rejected, null block ids included', async () => {
    const { db } = await openFresh();
    const noteId = randomUUID();
    insertNote(db, 't', 'b', { id: noteId });
    const attId = randomUUID();
    db.prepare<[string, string]>(
      "INSERT INTO attachments(id, managed_relative_path, sha256, mime, size_bytes, kind, created_at) VALUES (?, 'attachments/ab/x.png', ?, 'image/png', 1, 'image', 1)",
    ).run(attId, 'a'.repeat(64));
    const link = () =>
      db.prepare<[string, string]>('INSERT INTO note_attachments(note_id, attachment_id, block_id) VALUES (?, ?, NULL)').run(noteId, attId);
    link();
    expect(link).toThrow();
  });
});

describe('migration 002 (D-044)', () => {
  it('upgrades a populated v1 database to v2 keeping every row, with one openable v1 copy', async () => {
    const { dbFile, preMigrationDir } = layout();
    // Build a real v1 database with the first migration only.
    const v1 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 1) });
    if (!v1.ok) throw new Error('v1 open failed');
    expect(v1.schemaVersion).toBe(1);
    const db1 = v1.db;
    const project = randomUUID();
    const common1 = randomUUID();
    const nested = randomUUID();
    const f = db1.prepare<[string, string | null, string | null, string]>(
      'INSERT INTO folders(id, project_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)',
    );
    db1.prepare<[string]>("INSERT INTO projects(id, name, created_at, updated_at) VALUES (?, 'Work', 1, 1)").run(project);
    f.run(common1, null, null, 'Common folder');
    f.run(nested, null, common1, 'Nested');
    const liveNote = randomUUID();
    const trashedNote = randomUUID();
    db1
      .prepare<[string, string, string]>(
        "INSERT INTO notes(id, project_id, folder_id, title, format, content_text, plain_text, created_at, updated_at) VALUES (?, NULL, ?, ?, 'plain', 'body', 'body', 1, 1)",
      )
      .run(liveNote, nested, 'live');
    db1
      .prepare<[string, string]>(
        "INSERT INTO notes(id, project_id, folder_id, title, format, content_text, plain_text, created_at, updated_at, deleted_at, trash_batch_id) VALUES (?, NULL, ?, 'gone', 'plain', 'x', 'x', 1, 1, 5, 'batch')",
      )
      .run(trashedNote, common1);
    db1.prepare("INSERT INTO settings(key, value, updated_at) VALUES ('appearance.theme', '{\"v\":1,\"value\":\"dark\"}', 1)").run();
    db1.close();

    const v2 = await openDatabase({ dbFile, preMigrationDir });
    if (!v2.ok) throw new Error('v2 open failed');
    const db = trackDb(v2.db);
    expect(v2.schemaVersion).toBe(LATEST);
    expect(v2.migratedFrom).toBe(1);
    expect(v2.preMigrationCopy).toBe(true);
    const count = (table: string) => db.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()?.n;
    expect([count('projects'), count('folders'), count('notes'), count('settings')]).toEqual([1, 2, 2, 1]);
    const idx = db.prepare<[], { name: string }>('PRAGMA index_list(notes)').all().map((r) => r.name);
    expect(idx).toEqual(expect.arrayContaining(['notes_folder_all', 'notes_project_all', 'notes_deleted']));
    db.exec("INSERT INTO notes_fts(notes_fts) VALUES('integrity-check')");
    expect(match(db, 'live')).toHaveLength(1);
    const copies = fs.readdirSync(preMigrationDir);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^infinity-notes-v1-/);
    const copy = trackDb(openBetterSqlite(path.join(preMigrationDir, copies[0]!), { readonly: true, fileMustExist: true }));
    expect(copy.pragmaValue('user_version')).toBe(1);
    expect(copy.prepare<[], { n: number }>('SELECT count(*) AS n FROM notes').get()?.n).toBe(2);
  });
});

describe('migration 005 reminders (D-073)', () => {
  it('upgrades a populated v4 database to v5 keeping every row, with one openable v4 copy', async () => {
    const { dbFile, preMigrationDir } = layout();
    const v4 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 4) });
    if (!v4.ok) throw new Error('v4 open failed');
    const noteId = randomUUID();
    insertNote(v4.db, 'Before reminders', 'body', { id: noteId });
    v4.db.prepare<[string, string]>("INSERT INTO window_state(key, note_id, open, updated_at) VALUES (?, ?, 1, 1)").run(`sticky:${noteId}`, noteId);
    v4.db.close();

    const v5 = await openDatabase({ dbFile, preMigrationDir });
    if (!v5.ok) throw new Error('v5 open failed');
    const db = trackDb(v5.db);
    expect(v5.schemaVersion).toBe(LATEST);
    expect(v5.migratedFrom).toBe(4);
    expect(v5.preMigrationCopy).toBe(true);
    const count = (table: string) => db.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()?.n;
    expect([count('notes'), count('window_state'), count('reminders'), count('occurrences'), count('alert_deliveries')]).toEqual([1, 1, 0, 0, 0]);
    const indexes = db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('occurrences', 'alert_deliveries')").all().map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(['occurrences_next_alert', 'occurrences_reminder_due', 'occurrences_due', 'alert_deliveries_claimed', 'alert_deliveries_batch']));
    const copies = fs.readdirSync(preMigrationDir);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^infinity-notes-v4-/);
    const copy = trackDb(openBetterSqlite(path.join(preMigrationDir, copies[0]!), { readonly: true, fileMustExist: true }));
    expect(copy.pragmaValue('user_version')).toBe(4);
    expect(copy.prepare<[], { n: number }>('SELECT count(*) AS n FROM notes').get()?.n).toBe(1);
  });

  it('CHECK and UNIQUE constraints guard occurrence states and delivery claims; purging a note cascades', async () => {
    const t = await openFresh();
    const db = t.db;
    const noteId = randomUUID();
    insertNote(db, 'n', 'body', { id: noteId });
    const reminderId = randomUUID();
    db.prepare<[string, string]>(
      "INSERT INTO reminders(id, note_id, title, zone_id, start_local_date, local_time, created_at, updated_at) VALUES (?, ?, 'T', 'Asia/Dhaka', '2026-10-09', '17:00', 1, 1)",
    ).run(reminderId, noteId);
    const occ = (state: string, extra: { snoozed?: number | null; next?: number | null; completed?: number | null; due?: number } = {}) => {
      const id = randomUUID();
      db.prepare<[string, string, number, string, number | null, number | null, number | null]>(
        "INSERT INTO occurrences(id, reminder_id, due_at_utc, original_local_date_time, state, snoozed_until_utc, next_alert_at_utc, completed_at, created_at, updated_at) VALUES (?, ?, ?, '2026-10-09T17:00', ?, ?, ?, ?, 1, 1)",
      ).run(id, reminderId, extra.due ?? 100, state, extra.snoozed ?? null, extra.next ?? null, extra.completed ?? null);
      return id;
    };
    expect(() => occ('snoozed', { due: 1 })).toThrow(/CHECK/);
    expect(() => occ('completed', { due: 2 })).toThrow(/CHECK/);
    expect(() => occ('pending', { due: 3, completed: 5 })).toThrow(/CHECK/);
    expect(() => occ('missed', { due: 4, next: 5 })).toThrow(/CHECK/);
    expect(() => occ('done', { due: 5 })).toThrow(/CHECK/);
    const pending = occ('pending', { due: 6, next: 6 });
    expect(() => occ('pending', { due: 6 })).toThrow(/UNIQUE/);
    const deliver = (sequence: number) =>
      db.prepare<[string, string, number]>(
        "INSERT INTO alert_deliveries(id, occurrence_id, alert_sequence, kind, presentation, batch_id, reason, claimed_at, outcome) VALUES (?, ?, ?, 'initial', 'single', 'b', 'timer', 1, 'claimed')",
      ).run(randomUUID(), pending, sequence);
    deliver(0);
    expect(() => deliver(0)).toThrow(/UNIQUE/);
    expect(() => db.prepare("UPDATE reminders SET anchor_state = 'block_missing'").run()).toThrow(/CHECK/);
    db.prepare<[string]>('DELETE FROM notes WHERE id = ?').run(noteId);
    expect(['reminders', 'occurrences', 'alert_deliveries'].map((table) => db.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()?.n)).toEqual([0, 0, 0]);
  });
});

describe('migration 006 reminder sources (D-088)', () => {
  it('upgrades a populated v5 database to v6 keeping every v5 row, with one openable v5 copy', async () => {
    const { dbFile, preMigrationDir } = layout();
    const v5 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 5) });
    if (!v5.ok) throw new Error('v5 open failed');
    const noteId = randomUUID();
    const reminderId = randomUUID();
    const occurrenceId = randomUUID();
    insertNote(v5.db, 'Before sources', 'body', { id: noteId });
    v5.db.prepare<[string, string]>(
      "INSERT INTO reminders(id, note_id, title, zone_id, start_local_date, local_time, created_at, updated_at) VALUES (?, ?, 'T', 'Asia/Dhaka', '2026-10-09', '17:00', 1, 1)",
    ).run(reminderId, noteId);
    v5.db.prepare<[string, string]>(
      "INSERT INTO occurrences(id, reminder_id, due_at_utc, original_local_date_time, state, next_alert_at_utc, created_at, updated_at) VALUES (?, ?, 100, '2026-10-09T17:00', 'pending', 100, 1, 1)",
    ).run(occurrenceId, reminderId);
    v5.db.prepare<[string, string]>(
      "INSERT INTO alert_deliveries(id, occurrence_id, alert_sequence, kind, presentation, batch_id, reason, claimed_at, outcome) VALUES (?, ?, 0, 'initial', 'single', 'b', 'timer', 1, 'dispatched')",
    ).run(randomUUID(), occurrenceId);
    const dump = (db: Db) => ['notes', 'reminders', 'occurrences', 'alert_deliveries'].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = dump(v5.db);
    v5.db.close();

    const v6 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 6) });
    if (!v6.ok) throw new Error('v6 open failed');
    const db = trackDb(v6.db);
    expect(v6.schemaVersion).toBe(6);
    expect(v6.migratedFrom).toBe(5);
    expect(v6.preMigrationCopy).toBe(true);
    expect(dump(db)).toEqual(before);
    expect(['reminder_sources', 'suggestion_dismissals'].map((table) => db.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()?.n)).toEqual([0, 0]);
    const indexes = db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('reminder_sources', 'suggestion_dismissals')").all().map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(['reminder_sources_note', 'suggestion_dismissals_note', 'suggestion_dismissals_date']));
    const copies = fs.readdirSync(preMigrationDir);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^infinity-notes-v5-/);
    const copy = trackDb(openBetterSqlite(path.join(preMigrationDir, copies[0]!), { readonly: true, fileMustExist: true }));
    expect(copy.pragmaValue('user_version')).toBe(5);
    expect(dump(copy)).toEqual(before);
  });

  it('every CHECK of the source and dismissal tables refuses a bad row; deleting a reminder or a note cascades', async () => {
    const { db } = await openFresh();
    const noteId = randomUUID();
    insertNote(db, 'n', 'body', { id: noteId });
    const reminder = () => {
      const id = randomUUID();
      db.prepare<[string, string]>(
        "INSERT INTO reminders(id, note_id, title, zone_id, start_local_date, local_time, created_at, updated_at) VALUES (?, ?, 'T', 'Asia/Dhaka', '2026-10-09', '17:00', 1, 1)",
      ).run(id, noteId);
      return id;
    };
    const good = { block_id: randomUUID(), source_text: 'tomorrow', span_start: 4, span_end: 12, span_ordinal: 0, reference_zone: 'Asia/Dhaka', parser_version: 1, origin: 'suggestion', source_state: 'ok' };
    const source = (over: Partial<Record<keyof typeof good, unknown>> = {}, reminderId = reminder()) =>
      db
        .prepare(
          `INSERT INTO reminder_sources(reminder_id, note_id, block_id, source_text, span_start, span_end, span_ordinal, reference_instant_utc, reference_zone, parser_version, origin, source_state, created_at, updated_at)
           VALUES (@reminder_id, @note_id, @block_id, @source_text, @span_start, @span_end, @span_ordinal, 1, @reference_zone, @parser_version, @origin, @source_state, 1, 1)`,
        )
        .run({ ...good, ...over, reminder_id: reminderId, note_id: noteId });
    const bad: Array<Partial<Record<keyof typeof good, unknown>>> = [
      { source_text: '' },
      { source_text: 'x'.repeat(501) },
      { span_start: -1 },
      { span_ordinal: -1 },
      { reference_zone: '' },
      { parser_version: 0 },
      { origin: 'guess' },
      { source_state: 'stale' },
      { block_id: null },
      { span_end: null },
      { span_end: 4 },
    ];
    for (const over of bad) expect(() => source(over), JSON.stringify(over)).toThrow(/CHECK/);
    const kept = reminder();
    source({}, kept);
    source({ block_id: null, span_start: null, span_end: null });
    expect(() => source({}, kept)).toThrow(/UNIQUE|PRIMARY/);

    const dismissal = (over: Record<string, unknown> = {}) =>
      db
        .prepare(
          'INSERT INTO suggestion_dismissals(dedupe_key, note_id, block_id, span_text, span_ordinal, reference_date, created_at) VALUES (@k, @n, NULL, @t, @o, @d, 1)',
        )
        .run({ k: randomBytes(32).toString('hex'), n: noteId, t: 'tomorrow', o: 0, d: '2026-10-08', ...over });
    for (const over of [{ k: 'short' }, { t: '' }, { o: -1 }, { d: '8 Oct 2026' }]) expect(() => dismissal(over), JSON.stringify(over)).toThrow(/CHECK/);
    dismissal();

    const count = (table: string) => db.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()?.n;
    db.prepare<[string]>('DELETE FROM reminders WHERE id = ?').run(kept);
    expect([count('reminder_sources'), count('suggestion_dismissals')]).toEqual([1, 1]);
    db.prepare<[string]>('DELETE FROM notes WHERE id = ?').run(noteId);
    expect([count('reminders'), count('reminder_sources'), count('suggestion_dismissals')]).toEqual([0, 0, 0]);
  });
});

describe('migration 007 references and tags (D-098)', () => {
  it('upgrades a populated v6 database to v7 keeping every row, with one openable v6 copy', async () => {
    const { dbFile, preMigrationDir } = layout();
    const v6 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 6) });
    if (!v6.ok) throw new Error('v6 open failed');
    insertNote(v6.db, 'Before references', 'body');
    const before = v6.db.prepare('SELECT * FROM notes ORDER BY rowid').all();
    v6.db.close();

    const v7 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 7) });
    if (!v7.ok) throw new Error('v7 open failed');
    const db = trackDb(v7.db);
    expect([v7.schemaVersion, v7.migratedFrom, v7.preMigrationCopy]).toEqual([7, 6, true]);
    expect(db.prepare('SELECT * FROM notes ORDER BY rowid').all()).toEqual(before);
    const indexes = db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('note_references', 'note_tags')").all().map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(['note_references_unique', 'note_references_target', 'note_tags_tag']));
    const copies = fs.readdirSync(preMigrationDir);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^infinity-notes-v6-/);
  });

  it('refuses bad rows, keeps one row per source block and target, cascades with the source and keeps a purged target title', async () => {
    const { db } = await openFresh();
    const source = randomUUID();
    const target = randomUUID();
    insertNote(db, 'Source', 'body', { id: source });
    insertNote(db, 'Target title', 'body', { id: target });
    const ref = (over: Record<string, unknown> = {}) =>
      db
        .prepare('INSERT INTO note_references(source_note_id, source_block_id, target_note_id, target_block_id, target_title_snapshot) VALUES (@s, @sb, @t, @tb, @title)')
        .run({ s: source, sb: null, t: target, tb: null, title: 'old', ...over });
    for (const over of [{ t: 'short' }, { sb: 'short' }, { tb: 'short' }, { title: 'x'.repeat(201) }]) expect(() => ref(over), JSON.stringify(over)).toThrow(/CHECK/);
    expect(() => ref({ s: randomUUID() })).toThrow(/FOREIGN KEY/);
    ref();
    expect(() => ref()).toThrow(/UNIQUE/);
    ref({ tb: randomUUID() });

    db.prepare<[string]>('DELETE FROM notes WHERE id = ?').run(target);
    const snapshots = db.prepare<[], { target_title_snapshot: string }>('SELECT target_title_snapshot FROM note_references').all();
    expect(snapshots.map((r) => r.target_title_snapshot)).toEqual(['Target title', 'Target title']);

    db.prepare("INSERT INTO tags(name) VALUES ('work')").run();
    expect(() => db.prepare("INSERT INTO tags(name) VALUES ('')").run()).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO tags(name) VALUES ('work')").run()).toThrow(/UNIQUE/);
    db.prepare<[string]>("INSERT INTO note_tags(note_id, tag_id) SELECT ?, id FROM tags WHERE name = 'work'").run(source);
    db.prepare<[string]>('DELETE FROM notes WHERE id = ?').run(source);
    const count = (table: string) => db.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()?.n;
    expect([count('note_references'), count('note_tags'), count('tags')]).toEqual([0, 0, 1]);
  });
});

describe('migration 008 sticky text color (v0.2.0)', () => {
  it('upgrades a populated v7 database to v8: every note keeps its row and gets no text color', async () => {
    const { dbFile, preMigrationDir } = layout();
    const v7 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 7) });
    if (!v7.ok) throw new Error('v7 open failed');
    const id = randomUUID();
    insertNote(v7.db, 'Sticky', 'body', { id });
    v7.db.prepare<[string]>("UPDATE notes SET sticky_enabled = 1, color = 'blue' WHERE id = ?").run(id);
    const before = v7.db.prepare('SELECT * FROM notes ORDER BY rowid').all() as Array<Record<string, unknown>>;
    v7.db.close();

    const v8 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 8) });
    if (!v8.ok) throw new Error('v8 open failed');
    const db = trackDb(v8.db);
    expect([v8.schemaVersion, v8.migratedFrom, v8.preMigrationCopy]).toEqual([8, 7, true]);
    expect(db.prepare('SELECT * FROM notes ORDER BY rowid').all()).toEqual(before.map((row) => ({ ...row, text_color: null })));
    expect(fs.readdirSync(preMigrationDir)[0]).toMatch(/^infinity-notes-v7-/);
  });

  it('stores only a lowercase #rrggbb text color or none; a custom note color is any text', async () => {
    const { db } = await openFresh();
    const id = randomUUID();
    insertNote(db, 'Sticky', 'body', { id });
    const setText = (value: string | null) => db.prepare<[string | null, string]>('UPDATE notes SET text_color = ? WHERE id = ?').run(value, id);
    setText('#e03131');
    setText(null);
    for (const bad of ['#E03131', 'red', '#e0313', '#e031311', '#e0313g', '']) expect(() => setText(bad), bad).toThrow(/CHECK/);
    db.prepare<[string]>("UPDATE notes SET color = '#3a7bd5' WHERE id = ?").run(id);
    expect(db.prepare<[string], { color: string; text_color: string | null }>('SELECT color, text_color FROM notes WHERE id = ?').get(id)).toEqual({ color: '#3a7bd5', text_color: null });
  });
});

describe('migration 009 linked files (v0.2.0, D-108)', () => {
  it('upgrades a populated v8 database to v9: notes are untouched and the link tables start empty', async () => {
    const { dbFile, preMigrationDir } = layout();
    const v8 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 8) });
    if (!v8.ok) throw new Error('v8 open failed');
    insertNote(v8.db, 'With files', 'body', { id: randomUUID() });
    const before = v8.db.prepare('SELECT * FROM notes ORDER BY rowid').all();
    v8.db.close();

    const v9 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 9) });
    if (!v9.ok) throw new Error('v9 open failed');
    const db = trackDb(v9.db);
    expect([v9.schemaVersion, v9.migratedFrom, v9.preMigrationCopy]).toEqual([9, 8, true]);
    expect(db.prepare('SELECT * FROM notes ORDER BY rowid').all()).toEqual(before);
    expect(db.prepare('SELECT count(*) AS n FROM linked_files').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM note_linked_files').get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'note_linked_files' AND name NOT LIKE 'sqlite_%'").all()).toEqual([{ name: 'note_linked_files_link' }]);
  });
});

describe('migration 010 note locks (v0.2.0, D-111)', () => {
  const lockRow = (db: Db, noteId: string) =>
    db
      .prepare<[string, Buffer, Buffer, Buffer]>("INSERT INTO note_locks(note_id, kdf, salt, password_key, content, created_at, updated_at) VALUES (?, '{}', ?, ?, ?, 1, 1)")
      .run(noteId, randomBytes(16), randomBytes(60), randomBytes(40));

  it('upgrades a populated v9 database to v10: notes are untouched and unlocked, no lock rows', async () => {
    const { dbFile, preMigrationDir } = layout();
    const v9 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 9) });
    if (!v9.ok) throw new Error('v9 open failed');
    insertNote(v9.db, 'Private', 'body', { id: randomUUID() });
    const before = v9.db.prepare('SELECT * FROM notes ORDER BY rowid').all() as Array<Record<string, unknown>>;
    v9.db.close();

    const v10 = await openDatabase({ dbFile, preMigrationDir });
    if (!v10.ok) throw new Error('v10 open failed');
    const db = trackDb(v10.db);
    expect([v10.schemaVersion, v10.migratedFrom, v10.preMigrationCopy]).toEqual([10, 9, true]);
    expect(db.prepare('SELECT * FROM notes ORDER BY rowid').all()).toEqual(before.map((row) => ({ ...row, locked: 0 })));
    expect(db.prepare('SELECT count(*) AS n FROM note_locks').get()).toEqual({ n: 0 });
  });

  it('keeps notes.locked in step with note_locks and refuses plaintext for a locked note', async () => {
    const { db } = await openFresh();
    const id = randomUUID();
    insertNote(db, 'Secret', 'the body', { id });
    const locked = () => db.prepare<[string], { locked: number }>('SELECT locked FROM notes WHERE id = ?').get(id)!.locked;
    // The plaintext must be gone before the lock row exists.
    expect(() => lockRow(db, id)).toThrow(/locked note content must be encrypted/);
    db.prepare<[string]>("UPDATE notes SET content_text = NULL, plain_text = '' WHERE id = ?").run(id);
    lockRow(db, id);
    expect(locked()).toBe(1);
    expect(() => db.prepare<[string]>("UPDATE notes SET content_text = 'leak' WHERE id = ?").run(id)).toThrow(/must be encrypted/);
    expect(() => db.prepare<[string]>("UPDATE notes SET plain_text = 'leak' WHERE id = ?").run(id)).toThrow(/must be encrypted/);
    db.prepare<[string]>("UPDATE notes SET title = 'Renamed' WHERE id = ?").run(id);
    expect(() =>
      db.prepare<[string, string]>("INSERT INTO note_versions(id, note_id, revision, format, content_snapshot, reason, created_at) VALUES (?, ?, 1, 'plain', 'leak', 'auto', 1)").run(randomUUID(), id),
    ).toThrow(/keep no versions/);
    const draft = (content: string, title: string | null) =>
      db
        .prepare<[string, string, string, string | null]>("INSERT INTO note_drafts(id, note_id, view_id, base_revision, format, content, title, reason, created_at) VALUES (?, ?, 'v', 0, 'plain', ?, ?, 'conflict', 1)")
        .run(randomUUID(), id, content, title);
    expect(() => draft('leak', null)).toThrow(/must be sealed/);
    expect(() => draft('sealed:AAAA', 'title')).toThrow(/must be sealed/);
    draft('sealed:AAAA', null);
    expect(() =>
      db.prepare<[string, string]>("INSERT INTO suggestion_dismissals(dedupe_key, note_id, span_text, span_ordinal, reference_date, created_at) VALUES (?, ?, 'tomorrow', 0, '2026-10-10', 1)").run('a'.repeat(64), id),
    ).toThrow(/no suggestion dismissals/);
    db.prepare<[string]>('DELETE FROM note_locks WHERE note_id = ?').run(id);
    expect(locked()).toBe(0);
    db.prepare<[string]>("UPDATE notes SET content_text = 'back', plain_text = 'back' WHERE id = ?").run(id);
  });

  it('checks the lock row and removes it with its note', async () => {
    const { db } = await openFresh();
    const id = randomUUID();
    insertNote(db, 'n', '', { id });
    db.prepare<[string]>("UPDATE notes SET content_text = NULL WHERE id = ?").run(id);
    const insert = (salt: Buffer, wrapped: Buffer, content: Buffer, kdf = '{}') =>
      db
        .prepare<[string, string, Buffer, Buffer, Buffer]>('INSERT INTO note_locks(note_id, kdf, salt, password_key, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)')
        .run(id, kdf, salt, wrapped, content);
    expect(() => insert(randomBytes(8), randomBytes(60), randomBytes(40))).toThrow(/CHECK/);
    expect(() => insert(randomBytes(16), Buffer.alloc(0), randomBytes(40))).toThrow(/CHECK/);
    expect(() => insert(randomBytes(16), randomBytes(60), randomBytes(40), 'not json')).toThrow(/CHECK/);
    insert(randomBytes(16), randomBytes(60), randomBytes(40));
    db.prepare<[string]>('DELETE FROM notes WHERE id = ?').run(id);
    expect(db.prepare('SELECT count(*) AS n FROM note_locks').get()).toEqual({ n: 0 });
  });
});
