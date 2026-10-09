import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { BACKUP_DB_ENTRY, MANIFEST_ENTRY, parseBackupManifest } from '../../src/main/portability/backup-manifest';
import { AUTO_BACKUP_FAILED, AUTO_BACKUP_NAME_RE, AUTO_BACKUP_RETRY_MS } from '../../src/main/portability/auto-backup';
import { openArchive } from '../../src/main/portability/zip-archive';
import { PORTABILITY_MESSAGES } from '../../src/shared/contracts/portability';
import { DAY_MS } from '../../src/shared/versions/retention';
import { setupServices, type Services } from './hierarchy-helpers';
import { mkTmp } from './helpers';
import { paragraph, saveDoc, seedNotebook, tmpFile } from './portability-helpers';

const CTX = { webContentsId: 1 };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function backUp(s: Services, file: string) {
  s.pathQueue.push(file);
  const res = await s.portability.createBackup(CTX);
  if (res.canceled) throw new Error('canceled');
  return res;
}

describe('backup (INF-PORT-01)', () => {
  it('WAL content present: the archive has committed data that is still only in the WAL, the image and hashes', async () => {
    const s = await setupServices();
    const seeded = await seedNotebook(s);
    // Keep the last edit in the WAL: the main database file alone does not have it.
    s.t.db.pragma('wal_autocheckpoint = 0');
    const late = s.note(null, null, 'Late edit');
    saveDoc(s, late.id, { type: 'doc', content: [paragraph('5b3f0b8e-6b3a-4a59-9e7f-2d2a8a6a0c01', 'written last')] });
    expect(fs.statSync(`${s.paths.dbFile}-wal`).size).toBeGreaterThan(0);
    const mainOnly = path.join(mkTmp(), 'main-only.sqlite3');
    fs.copyFileSync(s.paths.dbFile, mainOnly);
    const stale = new Database(mainOnly, { readonly: true });
    expect(stale.prepare("SELECT count(*) AS n FROM notes WHERE title = 'Late edit'").get()).toEqual({ n: 0 });
    stale.close();

    const file = tmpFile('notebook.infinitybackup');
    const result = await backUp(s, file);
    expect(result).toMatchObject({ canceled: false, file, notes: 4, attachments: 1 });
    expect(s.pathDialogs.at(-1)).toMatchObject({ kind: 'save', title: 'Back up Infinity Notes' });
    expect(s.pathDialogs.at(-1)?.defaultName).toMatch(/^Infinity Notes \d{4}-\d{2}-\d{2}\.infinitybackup$/);

    const archive = await openArchive(file);
    try {
      expect([...archive.names].sort()).toEqual([`attachments/${seeded.attachment.id.slice(0, 2)}/${seeded.attachment.id}.png`, BACKUP_DB_ENTRY, MANIFEST_ENTRY].sort());
      const manifest = parseBackupManifest(await archive.read(MANIFEST_ENTRY, 1 << 20));
      expect(manifest).toMatchObject({ format: 'infinity-notes-backup', formatVersion: 1, schemaVersion: 7, notes: 4, missing: [] });
      expect(manifest.attachments).toEqual([{ id: seeded.attachment.id, path: expect.stringMatching(/\.png$/), sha256: sha(seeded.png), size: seeded.png.length }]);
      const dbCopy = path.join(mkTmp(), 'db.sqlite3');
      const extracted = await archive.extractTo(BACKUP_DB_ENTRY, dbCopy);
      expect(extracted).toEqual({ sha256: manifest.db.sha256, size: manifest.db.size });
      const copy = new Database(dbCopy, { readonly: true });
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(copy.pragma('journal_mode', { simple: true })).toBe('delete');
      expect(copy.prepare('SELECT plain_text FROM notes WHERE id = ?').get(late.id)).toEqual({ plain_text: 'written last' });
      copy.close();
    } finally {
      archive.close();
    }
    // The live database keeps working in WAL mode.
    expect(s.t.db.pragmaValue('journal_mode')).toBe('wal');
    expect(s.note(null, null, 'After backup').title).toBe('After backup');
    expect(fs.existsSync(path.join(s.dataDir, 'backup-tmp')) ? fs.readdirSync(path.join(s.dataDir, 'backup-tmp')) : []).toEqual([]);
  });

  it('a canceled dialog writes nothing; a second operation while one runs is refused', async () => {
    const s = await setupServices();
    await seedNotebook(s);
    expect(await s.portability.createBackup(CTX)).toEqual({ canceled: true });
    s.pathQueue.push(tmpFile('a.infinitybackup'), tmpFile('b.infinitybackup'));
    const [first, second] = await Promise.allSettled([s.portability.createBackup(CTX), s.portability.createBackup(CTX)]);
    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT', message: PORTABILITY_MESSAGES.busy } });
  });

  it('a file that cannot be written gives the plain write failure and leaves no partial archive', async () => {
    const s = await setupServices();
    const dir = mkTmp();
    s.pathQueue.push(path.join(dir, 'missing-folder', 'x.infinitybackup'));
    await expect(s.portability.createBackup(CTX)).rejects.toMatchObject({ code: 'INTERNAL', message: PORTABILITY_MESSAGES.writeFailed });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('automatic backup (INF-PORT-06)', () => {
  it('auto schedule: off by default, needs a folder, runs once per interval and keeps only its newest backups', async () => {
    const s = await setupServices();
    await seedNotebook(s);
    expect(s.portability.status()).toMatchObject({ auto: { enabled: false, directory: null, intervalDays: 7, keep: 5 }, lastAuto: null, rollbackCopies: [], lastRestore: null });
    await s.portability.runAutoBackup();
    expect(s.portability.status().lastAuto).toBeNull();
    expect(() => s.portability.setAuto({ enabled: true, intervalDays: 1, keep: 3 })).toThrow(PORTABILITY_MESSAGES.noFolder);

    const dir = mkTmp('infinity-auto-');
    fs.writeFileSync(path.join(dir, 'My own.infinitybackup'), 'keep me');
    s.pathQueue.push(dir);
    expect((await s.portability.chooseAutoFolder(CTX)).auto.directory).toBe(dir);
    expect(s.portability.setAuto({ enabled: true, intervalDays: 1, keep: 3 }).auto).toEqual({ enabled: true, directory: dir, intervalDays: 1, keep: 3 });

    const autoFiles = () => fs.readdirSync(dir).filter((n) => AUTO_BACKUP_NAME_RE.test(n)).sort();
    await s.portability.runAutoBackup();
    expect(autoFiles()).toHaveLength(1);
    expect(s.portability.status().lastAuto).toMatchObject({ ok: true, at: s.clock.now(), file: path.join(dir, autoFiles()[0]!) });
    s.clock.advance(DAY_MS - 1000);
    await s.portability.runAutoBackup();
    expect(autoFiles()).toHaveLength(1);
    for (let day = 0; day < 4; day += 1) {
      s.clock.advance(DAY_MS);
      await s.portability.runAutoBackup();
    }
    expect(autoFiles()).toHaveLength(3);
    expect(fs.existsSync(path.join(dir, 'My own.infinitybackup'))).toBe(true);
    // The newest ones stay: the last run's file is among them.
    expect(autoFiles()).toContain(path.basename(s.portability.status().lastAuto!.file!));
  });

  it('a folder that went away records the failure and retries after an hour, not at every check', async () => {
    const s = await setupServices();
    const dir = mkTmp('infinity-auto-');
    s.pathQueue.push(dir);
    await s.portability.chooseAutoFolder(CTX);
    s.portability.setAuto({ enabled: true, intervalDays: 7, keep: 5 });
    fs.rmSync(dir, { recursive: true });
    await s.portability.runAutoBackup();
    const failed = s.portability.status().lastAuto;
    expect(failed).toEqual({ at: s.clock.now(), ok: false, file: null, message: AUTO_BACKUP_FAILED });
    fs.mkdirSync(dir);
    s.clock.advance(AUTO_BACKUP_RETRY_MS - 1);
    await s.portability.runAutoBackup();
    expect(s.portability.status().lastAuto).toEqual(failed);
    s.clock.advance(1);
    await s.portability.runAutoBackup();
    expect(s.portability.status().lastAuto).toMatchObject({ ok: true });
    // Switching it off keeps the folder for later.
    expect(s.portability.setAuto({ enabled: false, intervalDays: 7, keep: 5 }).auto).toMatchObject({ enabled: false, directory: dir });
  });
});
