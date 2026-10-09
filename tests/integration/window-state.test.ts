import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openBetterSqlite } from '../../src/main/db/better-sqlite3-driver';
import { MIGRATIONS } from '../../src/main/db/migrations';
import { WindowStateRepo, stickyKey } from '../../src/main/db/repositories/window-state-repo';
import { openDatabase } from '../../src/main/db/open-database';
import { memoryLogger } from '../../src/main/services/logger';
import { setupServices } from './hierarchy-helpers';
import { mkTmp, trackDb } from './helpers';

const insertRow = (s: Awaited<ReturnType<typeof setupServices>>, key: string, noteId: string | null, bounds: string | null = null) =>
  s.t.db
    .prepare<[string, string | null, string | null]>('INSERT INTO window_state(key, note_id, bounds, open, updated_at) VALUES (?, ?, ?, 1, 1)')
    .run(key, noteId, bounds);

describe('migration 004 window_state (D-062)', () => {
  it('upgrades a populated v3 database to v4 keeping every row, with one openable v3 copy', async () => {
    const dir = mkTmp();
    const dbFile = path.join(dir, 'data', 'infinity-notes.sqlite3');
    const preMigrationDir = path.join(dir, 'data', 'pre-migration');
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const v3 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 3) });
    if (!v3.ok) throw new Error('v3 open failed');
    expect(v3.schemaVersion).toBe(3);
    v3.db
      .prepare(
        "INSERT INTO notes(id, title, format, content_text, plain_text, sticky_enabled, color, created_at, updated_at) VALUES ('0f8fad5b-d9cb-469f-a165-70867728950e', 'Sticky', 'plain', 'body', 'body', 1, 'green', 1, 1)",
      )
      .run();
    v3.db.prepare('INSERT INTO trash_reanchored(batch_id) VALUES (\'b\')').run();
    v3.db.close();

    const v4 = await openDatabase({ dbFile, preMigrationDir, migrations: MIGRATIONS.slice(0, 4) });
    if (!v4.ok) throw new Error('v4 open failed');
    const db = trackDb(v4.db);
    expect(v4.schemaVersion).toBe(4);
    expect(v4.migratedFrom).toBe(3);
    expect(v4.preMigrationCopy).toBe(true);
    expect(db.prepare<[], { n: number }>('SELECT count(*) AS n FROM notes WHERE sticky_enabled = 1 AND color = \'green\'').get()?.n).toBe(1);
    expect(db.prepare<[], { n: number }>('SELECT count(*) AS n FROM trash_reanchored').get()?.n).toBe(1);
    expect(db.prepare<[], { n: number }>('SELECT count(*) AS n FROM window_state').get()?.n).toBe(0);
    const copies = fs.readdirSync(preMigrationDir);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^infinity-notes-v3-/);
    const copy = trackDb(openBetterSqlite(path.join(preMigrationDir, copies[0]!), { readonly: true, fileMustExist: true }));
    expect(copy.pragmaValue('user_version')).toBe(3);
  });

  it('CHECK constraints: a sticky key must name its note; only main and widget may have no note', async () => {
    const s = await setupServices();
    const note = s.note(null, null, 'n', true);
    const other = s.note(null, null, 'o', true);
    expect(() => insertRow(s, stickyKey(note.id), null)).toThrow();
    expect(() => insertRow(s, stickyKey(other.id), note.id)).toThrow();
    expect(() => insertRow(s, 'tab:1', null)).toThrow();
    expect(() => insertRow(s, stickyKey(note.id), note.id, 'not json')).toThrow();
    expect(() => insertRow(s, stickyKey(note.id), note.id)).not.toThrow();
    expect(() => insertRow(s, 'main', null)).not.toThrow();
    expect(() => insertRow(s, 'widget', null)).not.toThrow();
    // One row per note.
    expect(() => s.t.db.prepare('INSERT INTO window_state(key, note_id, open, updated_at) VALUES (?, ?, 0, 1)').run(stickyKey(note.id), note.id)).toThrow();
  });

  it('reads schema-invalid bounds as null and warns once per key', async () => {
    const s = await setupServices();
    const note = s.note(null, null, 'n', true);
    insertRow(s, stickyKey(note.id), note.id, '{"x":1}');
    const logger = memoryLogger();
    const repo = new WindowStateRepo(s.t.db, logger);
    expect(repo.get(stickyKey(note.id))).toEqual({ bounds: null, displayId: null, open: true, collapsed: false, alwaysOnTop: false });
    expect(repo.get(stickyKey(note.id))?.bounds).toBeNull();
    expect(logger.lines.filter((l) => l.includes(`window-state: invalid bounds key=${stickyKey(note.id)}`))).toHaveLength(1);
  });

  it('upsertSticky merges patches into one row', async () => {
    const s = await setupServices();
    const note = s.note(null, null, 'n', true);
    const repo = new WindowStateRepo(s.t.db);
    repo.upsertSticky(note.id, { open: true }, 10);
    repo.upsertSticky(note.id, { bounds: { x: 5, y: 6, width: 300, height: 200 }, displayId: 2 }, 11);
    repo.upsertSticky(note.id, { collapsed: true, alwaysOnTop: true }, 12);
    expect(repo.get(stickyKey(note.id))).toEqual({ bounds: { x: 5, y: 6, width: 300, height: 200 }, displayId: 2, open: true, collapsed: true, alwaysOnTop: true });
    expect(s.row<{ updated_at: number }>('SELECT updated_at FROM window_state WHERE note_id = ?', note.id)?.updated_at).toBe(12);
  });

  it('lists only open rows of live stickies; closeStale and closeAllStickies close rows', async () => {
    const s = await setupServices();
    const live = s.note(null, null, 'live', true);
    const trashed = s.note(null, null, 'trashed', true);
    const plain = s.note(null, null, 'plain', false);
    const closed = s.note(null, null, 'closed', true);
    const repo = new WindowStateRepo(s.t.db);
    for (const n of [live, trashed, plain]) repo.upsertSticky(n.id, { open: true }, 1);
    repo.upsertSticky(closed.id, { open: false }, 1);
    s.trash.trashNote(trashed.id);
    expect(repo.listOpenStickies()).toEqual([live.id]);
    expect(repo.closeStale(2)).toBe(2);
    expect(repo.get(stickyKey(trashed.id))?.open).toBe(false);
    expect(repo.get(stickyKey(plain.id))?.open).toBe(false);
    expect(repo.closeAllStickies(3)).toBe(1);
    expect(repo.listOpenStickies()).toEqual([]);
  });

  it('purging the note cascades its window state away; trash keeps it', async () => {
    const s = await setupServices();
    const note = s.note(null, null, 'n', true);
    new WindowStateRepo(s.t.db).upsertSticky(note.id, { open: true, collapsed: true }, 1);
    const { trashBatchId } = s.trash.trashNote(note.id);
    expect(s.rows('SELECT key FROM window_state')).toHaveLength(1);
    s.trash.purge({ target: { kind: 'batch', batchId: trashBatchId }, confirmed: true });
    expect(s.rows('SELECT key FROM window_state')).toHaveLength(0);
  });
});
