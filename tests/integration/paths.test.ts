import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureDataDirs, resolveDataPaths } from '../../src/main/app-paths';
import { openDatabase } from '../../src/main/db/open-database';
import { mkTmp, trackDb } from './helpers';

describe('data paths (INF-FND-07)', () => {
  it('lays out data under userData/data and logs under userData/logs', () => {
    const ud = path.join(mkTmp(), 'ud');
    const p = resolveDataPaths(ud);
    expect(p.dataDir).toBe(path.join(ud, 'data'));
    expect(p.dbFile).toBe(path.join(ud, 'data', 'infinity-notes.sqlite3'));
    expect(p.attachmentsDir).toBe(path.join(ud, 'data', 'attachments'));
    expect(p.attachmentsTmp).toBe(path.join(ud, 'data', 'attachments', 'tmp'));
    expect(p.preMigrationDir).toBe(path.join(ud, 'data', 'pre-migration'));
    expect(p.logsDir).toBe(path.join(ud, 'logs'));
  });

  it('creating the directories is idempotent', () => {
    const ud = path.join(mkTmp(), 'ud');
    const p = resolveDataPaths(ud);
    ensureDataDirs(p);
    ensureDataDirs(p);
    for (const dir of [p.dataDir, p.attachmentsDir, p.attachmentsTmp, p.preMigrationDir, p.logsDir]) {
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    }
  });

  it('the database file lands under <ud>/data', async () => {
    const ud = path.join(mkTmp(), 'ud');
    const p = resolveDataPaths(ud);
    ensureDataDirs(p);
    const r = await openDatabase({ dbFile: p.dbFile, preMigrationDir: p.preMigrationDir });
    if (!r.ok) throw new Error('open failed');
    trackDb(r.db);
    expect(fs.existsSync(p.dbFile)).toBe(true);
    expect(fs.readdirSync(ud).sort()).toEqual(['data', 'logs']);
  });
});
