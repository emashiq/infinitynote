import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LATEST } from '../../src/main/db/migrations';
import { prepareRestore } from '../../src/main/portability/restore';
import { DEFAULT_ARCHIVE_LIMITS, entryNameProblem } from '../../src/main/portability/zip-archive';
import { memoryLogger } from '../../src/main/services/logger';
import { PORTABILITY_MESSAGES } from '../../src/shared/contracts/portability';
import { craftZip, type CraftedEntry } from '../support/zip';
import { setupServices, type Services } from './hierarchy-helpers';
import { mkTmp } from './helpers';

const CTX = { webContentsId: 1 };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const DB = Buffer.from('SQLite format 3\0 not really a database');
const ATTACHMENT_ID = '0a0a0a0a-0000-4000-8000-000000000001';
const ATTACHMENT_PATH = `attachments/0a/${ATTACHMENT_ID}.png`;

function manifest(overrides: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      format: 'infinity-notes-backup',
      formatVersion: 1,
      appVersion: '0.1.0',
      schemaVersion: LATEST,
      createdAt: 1,
      notes: 0,
      db: { path: 'db/infinity-notes.sqlite3', sha256: sha(DB), size: DB.length },
      attachments: [],
      missing: [],
      ...overrides,
    }),
  );
}

const backupEntries = (extra: CraftedEntry[] = [], manifestOverrides: Record<string, unknown> = {}): CraftedEntry[] => [
  { name: 'manifest.json', data: manifest(manifestOverrides) },
  { name: 'db/infinity-notes.sqlite3', data: DB },
  ...extra,
];

function archiveFile(entries: CraftedEntry[], name = 'crafted.infinitybackup'): string {
  const dir = mkTmp('infinity-crafted-');
  const file = path.join(dir, 'inside', name);
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, craftZip(entries));
  return file;
}

async function refusal(s: Services, file: string, limits = DEFAULT_ARCHIVE_LIMITS) {
  try {
    await prepareRestore(file, { paths: s.paths, latestSchema: LATEST, logger: memoryLogger(), limits });
  } catch (err) {
    expect(fs.existsSync(s.paths.restoreStagingDir), 'staging removed').toBe(false);
    return err as { code: string; message: string };
  }
  throw new Error('expected a refusal');
}

describe('archive preflight (INF-PORT-03)', () => {
  it('entry names: relative, forward-slash and NFC only', () => {
    for (const bad of ['../evil', 'a/../../evil', '/etc/passwd', 'C:/Windows/evil', 'c:evil', 'a\\b', 'a//b', './a', 'a/./b', 'nul\0byte', '', 'e\u0301']) {
      expect(entryNameProblem(bad), JSON.stringify(bad)).not.toBeNull();
    }
    for (const good of ['manifest.json', 'db/infinity-notes.sqlite3', 'attachments/ab/x.png', 'folder/']) expect(entryNameProblem(good)).toBeNull();
  });

  it('refuses traversal, absolute, drive-letter and backslash names before writing anything', async () => {
    const s = await setupServices();
    for (const name of ['../evil.txt', 'db/../../evil.txt', '/evil.txt', 'C:/evil.txt', 'db\\evil.txt']) {
      const file = archiveFile(backupEntries([{ name, data: Buffer.from('x') }]));
      expect(await refusal(s, file), name).toMatchObject({ code: 'VALIDATION_FAILED', message: PORTABILITY_MESSAGES.unsafe });
      expect(fs.existsSync(path.join(path.dirname(file), 'evil.txt'))).toBe(false);
      expect(fs.existsSync(path.join(path.dirname(path.dirname(file)), 'evil.txt'))).toBe(false);
    }
  });

  it('refuses symbolic-link entries', async () => {
    const s = await setupServices();
    const file = archiveFile(backupEntries([{ name: ATTACHMENT_PATH, data: Buffer.from('/etc/passwd'), unixMode: 0o120777 }]));
    expect(await refusal(s, file)).toMatchObject({ message: PORTABILITY_MESSAGES.unsafe });
  });

  it('refuses too many entries, an oversized total and a compression bomb', async () => {
    const s = await setupServices();
    const many = archiveFile(backupEntries(Array.from({ length: 5 }, (_, i) => ({ name: `extra/${i}.txt`, data: Buffer.from('x') }))));
    expect(await refusal(s, many, { ...DEFAULT_ARCHIVE_LIMITS, maxEntries: 3 })).toMatchObject({ message: PORTABILITY_MESSAGES.tooLarge });
    const big = archiveFile(backupEntries([{ name: 'extra/big.bin', data: Buffer.alloc(4096, 1) }]));
    expect(await refusal(s, big, { ...DEFAULT_ARCHIVE_LIMITS, maxTotalBytes: 2048 })).toMatchObject({ message: PORTABILITY_MESSAGES.tooLarge });
    const bomb = archiveFile(backupEntries([{ name: 'extra/zeros.bin', data: Buffer.alloc(8 * 1024 * 1024), deflate: true }]));
    expect(await refusal(s, bomb)).toMatchObject({ message: PORTABILITY_MESSAGES.tooLarge });
  });

  it('refuses unsupported schema and format versions, unexpected or missing entries and bad hashes', async () => {
    const s = await setupServices();
    expect(await refusal(s, archiveFile(backupEntries([], { schemaVersion: LATEST + 1 })))).toMatchObject({ code: 'UNSUPPORTED', message: PORTABILITY_MESSAGES.newerSchema });
    expect(await refusal(s, archiveFile(backupEntries([], { formatVersion: 3 })))).toMatchObject({ code: 'UNSUPPORTED', message: PORTABILITY_MESSAGES.newerFormat });
    expect(await refusal(s, archiveFile(backupEntries([], { format: 'something-else' })))).toMatchObject({ message: PORTABILITY_MESSAGES.notArchive });
    expect(await refusal(s, archiveFile([{ name: 'db/infinity-notes.sqlite3', data: DB }]))).toMatchObject({ message: PORTABILITY_MESSAGES.notArchive });
    expect(await refusal(s, archiveFile(backupEntries([{ name: 'unexpected.txt', data: Buffer.from('x') }])))).toMatchObject({ message: PORTABILITY_MESSAGES.unsafe });
    const listed = { attachments: [{ id: ATTACHMENT_ID, path: ATTACHMENT_PATH, sha256: sha(Buffer.from('png')), size: 3 }] };
    expect(await refusal(s, archiveFile(backupEntries([], listed)))).toMatchObject({ message: PORTABILITY_MESSAGES.unsafe });
    expect(await refusal(s, archiveFile(backupEntries([{ name: ATTACHMENT_PATH, data: Buffer.from('PNG') }], listed)))).toMatchObject({ message: PORTABILITY_MESSAGES.damaged });
    // Every hash matches, but the database is not one.
    expect(await refusal(s, archiveFile(backupEntries()))).toMatchObject({ message: PORTABILITY_MESSAGES.databaseDamaged });
  });

  it('the restore channel refuses a malicious archive and the notebook stays as it was', async () => {
    const s = await setupServices();
    s.note(null, null, 'Kept');
    s.pathQueue.push(archiveFile(backupEntries([{ name: '../evil.txt', data: Buffer.from('x') }])));
    await expect(s.portability.prepareRestore(CTX)).rejects.toMatchObject({ message: PORTABILITY_MESSAGES.unsafe });
    await expect(s.portability.restore()).rejects.toMatchObject({ message: PORTABILITY_MESSAGES.noPrepared });
    expect(s.rows('SELECT title FROM notes')).toEqual([{ title: 'Kept' }]);
  });

  it('portable import refuses the same unsafe archives and unknown formats, writing nothing', async () => {
    const s = await setupServices();
    const data = (overrides: Record<string, unknown> = {}) =>
      Buffer.from(JSON.stringify({ format: 'infinity-notes-export', formatVersion: 1, appVersion: '0.1.0', createdAt: 1, projects: [], folders: [], notes: [], reminders: [], attachments: [], ...overrides }));
    const cases: Array<[CraftedEntry[], string]> = [
      [[{ name: 'data.json', data: data() }, { name: '../evil.txt', data: Buffer.from('x') }], PORTABILITY_MESSAGES.unsafe],
      [[{ name: 'data.json', data: data() }, { name: 'attachments/x.png', data: Buffer.from('x'), unixMode: 0o120777 }], PORTABILITY_MESSAGES.unsafe],
      [[{ name: 'data.json', data: data({ formatVersion: 3 }) }], PORTABILITY_MESSAGES.newerFormat],
      [[{ name: 'data.json', data: Buffer.from('{not json') }], PORTABILITY_MESSAGES.notArchive],
      [[{ name: 'data.json', data: data({ notes: [{ id: ATTACHMENT_ID, projectId: null, folderId: '0a0a0a0a-0000-4000-8000-000000000009', title: 'x', format: 'plain', content: 'x', sticky: false, color: null, pinned: false, favorite: false, tags: [] }] }) }], PORTABILITY_MESSAGES.notArchive],
      [[{ name: 'data.json', data: Buffer.alloc(8 * 1024 * 1024, 32), deflate: true }], PORTABILITY_MESSAGES.tooLarge],
    ];
    for (const [entries, message] of cases) {
      s.pathQueue.push(archiveFile(entries, 'notes.infinityexport'));
      await expect(s.portability.importPortable(CTX), message).rejects.toMatchObject({ message });
    }
    expect(s.rows('SELECT id FROM notes')).toEqual([]);
    expect(s.rows('SELECT id FROM folders')).toEqual([]);
  });
});
