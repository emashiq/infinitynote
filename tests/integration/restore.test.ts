import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PORTABILITY_MESSAGES } from '../../src/shared/contracts/portability';
import { createHash, randomUUID } from 'node:crypto';
import { openBetterSqlite } from '../../src/main/db/better-sqlite3-driver';
import { writeBackup } from '../../src/main/portability/backup-writer';
import { openArchive } from '../../src/main/portability/zip-archive';
import { memoryLogger } from '../../src/main/services/logger';
import { setupServices, type Services } from './hierarchy-helpers';
import { cleanProfile, restartWithRestore, seedNotebook, tmpFile } from './portability-helpers';
import { makePng } from '../support/png';

const CTX = { webContentsId: 1 };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const nextTask = () => new Promise((resolve) => setImmediate(resolve));

const SNAPSHOT_SQL = {
  notes: 'SELECT id, project_id, folder_id, title, format, content_json, content_text, plain_text, revision, sticky_enabled, color, pinned_at, favorite FROM notes ORDER BY id',
  references: 'SELECT source_note_id, source_block_id, target_note_id, target_block_id, target_title_snapshot FROM note_references ORDER BY source_note_id',
  reminders: 'SELECT id, note_id, block_id, title, zone_id, start_local_date, local_time, recurrence FROM reminders ORDER BY id',
  occurrences: 'SELECT id, reminder_id, due_at_utc, state, next_alert_at_utc FROM occurrences ORDER BY id',
  attachments: 'SELECT id, managed_relative_path, sha256, size_bytes FROM attachments ORDER BY id',
  tags: 'SELECT nt.note_id, t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id ORDER BY nt.note_id, t.name',
  folders: 'SELECT id, project_id, parent_id, name FROM folders ORDER BY id',
  projects: 'SELECT id, name FROM projects ORDER BY id',
} as const;

function snapshot(s: Services) {
  return Object.fromEntries(Object.entries(SNAPSHOT_SQL).map(([k, sql]) => [k, s.rows(sql)]));
}

/** A notebook backed up to a file, plus what it looked like. */
async function backedUpNotebook() {
  const a = await setupServices();
  const seeded = await seedNotebook(a);
  a.t.db.pragma('wal_autocheckpoint = 0');
  const file = tmpFile('notebook.infinitybackup');
  a.pathQueue.push(file);
  await a.portability.createBackup(CTX);
  return { a, seeded, file, expected: snapshot(a) };
}

/** A profile with its own note and image: the data a failed restore must leave usable. */
async function profileWithOwnData() {
  const b = await cleanProfile();
  const mine = b.note(null, null, 'Mine');
  const png = makePng(3, 3, [200, 10, 10, 255]);
  const { attachment } = await b.attachments.importBytes({ kind: 'image', bytes: png });
  const imagePath = path.join(b.dataDir, b.row<{ p: string }>('SELECT managed_relative_path AS p FROM attachments WHERE id = ?', attachment.id)!.p);
  return { b, mine, imagePath, png };
}

async function schedule(b: Services, file: string) {
  b.pathQueue.push(file);
  const prepared = await b.portability.prepareRestore(CTX);
  expect(await b.portability.restore()).toEqual({ restarting: true });
  await nextTask();
  expect(b.restarts.count).toBe(1);
  return prepared;
}

function expectOriginalIntact(services: Services, own: { mine: { id: string }; imagePath: string; png: Buffer }) {
  expect(services.rows('SELECT title FROM notes')).toEqual([{ title: 'Mine' }]);
  expect(sha(fs.readFileSync(own.imagePath))).toBe(sha(own.png));
  // Still usable: a new note can be written.
  expect(services.note(null, null, 'Still works').title).toBe('Still works');
  expect(services.portability.status().rollbackCopies).toEqual([]);
  expect(fs.existsSync(services.paths.restorePendingFile)).toBe(false);
  expect(fs.existsSync(services.paths.restoreStagingDir)).toBe(false);
}

describe('restore (INF-PORT-02)', () => {
  it('restores an edited notebook with images into a clean profile: content, hashes, references and reminders', async () => {
    const { seeded, file, expected } = await backedUpNotebook();
    const b = await cleanProfile();
    const prepared = await schedule(b, file);
    expect(prepared).toMatchObject({ canceled: false, summary: { schemaVersion: 7, notes: 3, attachments: 1, appVersion: '0.1.0' } });
    expect(b.pathDialogs.at(-1)).toMatchObject({ kind: 'open', title: 'Restore from backup' });

    const { restore, services: r } = await restartWithRestore(b);
    expect(restore).toEqual({ status: 'restored', message: PORTABILITY_MESSAGES.restored });
    expect(snapshot(r)).toEqual(expected);
    const stored = r.row<{ p: string }>('SELECT managed_relative_path AS p FROM attachments WHERE id = ?', seeded.attachment.id)!.p;
    expect(sha(fs.readFileSync(path.join(r.dataDir, stored)))).toBe(sha(seeded.png));
    expect(r.references.list(seeded.design.id).backlinks.map((l) => l.sourceNoteId)).toEqual([seeded.index.id]);
    expect(r.reminders.listForNote(seeded.design.id).reminders.map((x) => ({ title: x.title, blockId: x.blockId }))).toEqual([{ title: 'Ship it', blockId: seeded.block }]);
    expect(r.search.query({ query: 'backup' }).results.map((x) => x.note.id)).toEqual([seeded.design.id]);
    expect(r.t.db.pragmaValue('journal_mode')).toBe('wal');
    expect(r.portability.status().lastRestore).toEqual(restore);

    // The replaced (empty) profile is kept as a rollback copy until the user deletes it.
    const copies = r.portability.status().rollbackCopies;
    expect(copies).toHaveLength(1);
    expect(fs.existsSync(path.join(r.dataDir, copies[0]!.name, 'infinity-notes.sqlite3'))).toBe(true);
    expect((await r.portability.deleteRollback()).rollbackCopies).toEqual([]);
  });

  it('failure rollback: a restored copy that cannot be opened leaves the original data usable', async () => {
    const { file } = await backedUpNotebook();
    const own = await profileWithOwnData();
    await schedule(own.b, file);
    const { restore, services } = await restartWithRestore(own.b, { failOpen: 1 });
    expect(restore).toEqual({ status: 'failed', message: PORTABILITY_MESSAGES.restoreFailed });
    expectOriginalIntact(services, own);
  });

  it('failure rollback: a move that fails half way puts every live file back', async () => {
    const { file } = await backedUpNotebook();
    const own = await profileWithOwnData();
    await schedule(own.b, file);
    let moves = 0;
    const { restore, services } = await restartWithRestore(own.b, {
      move: async (from, to) => {
        moves += 1;
        // The live items moved out, the staged database moved in; the staged attachments fail.
        if (from.endsWith(`restore-staging${path.sep}attachments`)) throw new Error('disk full');
        fs.renameSync(from, to);
      },
    });
    expect(moves).toBeGreaterThanOrEqual(3);
    expect(restore?.status).toBe('failed');
    expectOriginalIntact(services, own);
  });

  it('an interrupted swap (the app stopped mid-way) is rolled back at the next start', async () => {
    const { file } = await backedUpNotebook();
    const own = await profileWithOwnData();
    await schedule(own.b, file);
    own.b.t.db.close();
    // Simulate a crash after the live data moved out and the staged database moved in.
    const { paths } = own.b;
    const rollback = path.join(paths.dataDir, 'rollback-20300101T000000Z');
    fs.mkdirSync(rollback);
    fs.renameSync(paths.dbFile, path.join(rollback, 'infinity-notes.sqlite3'));
    fs.renameSync(paths.attachmentsDir, path.join(rollback, 'attachments'));
    fs.renameSync(path.join(paths.restoreStagingDir, 'db', 'infinity-notes.sqlite3'), paths.dbFile);
    fs.writeFileSync(paths.restorePendingFile, JSON.stringify({ preparedAt: 1, swapping: 'rollback-20300101T000000Z' }));
    const reopen = { ...own.b, t: { ...own.b.t, db: { close: () => undefined } } } as unknown as Services;
    const { restore, services } = await restartWithRestore(reopen);
    expect(restore?.status).toBe('failed');
    expectOriginalIntact(services, own);
  });

  it('staged files changed after they were verified: nothing is swapped', async () => {
    const { file } = await backedUpNotebook();
    const own = await profileWithOwnData();
    await schedule(own.b, file);
    fs.appendFileSync(path.join(own.b.paths.restoreStagingDir, 'db', 'infinity-notes.sqlite3'), 'tampered');
    const { restore, services } = await restartWithRestore(own.b);
    expect(restore?.status).toBe('failed');
    expectOriginalIntact(services, own);
  });

  it('restoring with nothing prepared is refused; preparing never touches the live data', async () => {
    const own = await profileWithOwnData();
    await expect(own.b.portability.restore()).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: PORTABILITY_MESSAGES.noPrepared });
    const notArchive = tmpFile('notes.infinitybackup');
    fs.writeFileSync(notArchive, 'plain text, not a zip');
    own.b.pathQueue.push(notArchive);
    await expect(own.b.portability.prepareRestore(CTX)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: PORTABILITY_MESSAGES.notArchive });
    expect(fs.existsSync(own.b.paths.restoreStagingDir)).toBe(false);
    expect(own.b.rows('SELECT title FROM notes')).toEqual([{ title: 'Mine' }]);
  });

  it('a backup from an older schema is restored and migrated forward', async () => {
    const { a, file } = await backedUpNotebook();
    // The same notebook as schema 6 had it: without the Phase 07 tables.
    const work = tmpFile('old.sqlite3');
    const archive = await openArchive(file);
    await archive.extractTo('db/infinity-notes.sqlite3', work);
    archive.close();
    const old = openBetterSqlite(work);
    old.exec('DROP TRIGGER note_references_target_purged; DROP TABLE note_tags; DROP TABLE tags; DROP TABLE note_references; PRAGMA user_version = 6;');
    const oldFile = tmpFile('old.infinitybackup');
    await writeBackup({ db: old, dataDir: a.dataDir, appVersion: '0.0.6', now: () => 1, uuid: () => randomUUID(), logger: memoryLogger() }, oldFile);
    old.close();

    const b = await cleanProfile();
    expect(await schedule(b, oldFile)).toMatchObject({ canceled: false, summary: { schemaVersion: 6, appVersion: '0.0.6' } });
    const { restore, services: r } = await restartWithRestore(b);
    expect(restore?.status).toBe('restored');
    expect(r.t.db.pragmaValue('user_version')).toBe(7);
    expect(r.rows('SELECT title FROM notes ORDER BY title')).toEqual([{ title: 'Design' }, { title: 'Index' }, { title: 'Plain' }]);
    expect(fs.readdirSync(r.paths.preMigrationDir)).toHaveLength(1);
  });
});
