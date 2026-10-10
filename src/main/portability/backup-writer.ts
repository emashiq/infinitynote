import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_FORMAT, ARCHIVE_FORMAT_VERSION } from '../../shared/contracts/portability';
import { openBetterSqlite } from '../db/better-sqlite3-driver';
import type { Db, OpenOptions } from '../db/driver';
import { containedDataFile, type StoredArea } from '../services/stored-files';
import { errorDetail } from '../services/app-error';
import type { Logger } from '../services/logger';
import { BACKUP_DB_ENTRY, MANIFEST_ENTRY, type BackupManifestType } from './backup-manifest';
import { hashFile, writeArchive, type ArchiveItem } from './zip-archive';

export interface BackupWriterDeps {
  db: Db;
  /** `<userData>/data`; the snapshot is taken in `backup-tmp/` inside it. */
  dataDir: string;
  appVersion: string;
  now: () => number;
  uuid: () => string;
  logger: Logger;
  open?: (file: string, opts: OpenOptions) => Db;
}

export interface BackupResult {
  sizeBytes: number;
  notes: number;
  attachments: number;
}

interface SnapshotInfo {
  schemaVersion: number;
  notes: number;
  attachments: Array<{ id: string; path: string }>;
  documents: Array<{ id: string; path: string }>;
}

export function hasTable(db: Db, name: string): boolean {
  return db.prepare<[string], { n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.n === 1;
}

/**
 * Reads what the manifest needs from the snapshot and switches the copy to rollback-journal mode, so the archived
 * database is one self-contained file (the live database stays in WAL mode; restore switches the copy back).
 */
function inspectSnapshot(file: string, open: (file: string, opts: OpenOptions) => Db): SnapshotInfo {
  const snapshot = open(file, { fileMustExist: true });
  try {
    snapshot.pragma('journal_mode = DELETE');
    return {
      schemaVersion: Number(snapshot.pragmaValue('user_version')),
      notes: snapshot.prepare<[], { n: number }>('SELECT count(*) AS n FROM notes').get()?.n ?? 0,
      attachments: snapshot.prepare<[], { id: string; path: string }>('SELECT id, managed_relative_path AS path FROM attachments ORDER BY id').all(),
      // Schema 11 added document blobs (D-118).
      documents: hasTable(snapshot, 'document_blobs')
        ? snapshot.prepare<[], { id: string; path: string }>('SELECT id, relative_path AS path FROM document_blobs ORDER BY id').all()
        : [],
    };
  } finally {
    snapshot.close();
  }
}

/**
 * Writes a faithful backup (INF-PORT-01): a consistent snapshot of the live database taken with the SQLite online
 * backup API while the app keeps running, every attachment file and document blob the snapshot lists, and a manifest
 * with SHA-256 and sizes. Stored files are immutable once stored, and GC is paused while a backup runs
 * (PortabilityService). Linked documents are link records in the database; their files are not copied (D-108, D-118).
 */
export async function writeBackup(deps: BackupWriterDeps, destFile: string): Promise<BackupResult> {
  const work = path.join(deps.dataDir, 'backup-tmp', deps.uuid());
  await fs.promises.mkdir(work, { recursive: true });
  try {
    const snapshotFile = path.join(work, 'snapshot.sqlite3');
    await deps.db.backup(snapshotFile);
    const info = inspectSnapshot(snapshotFile, deps.open ?? openBetterSqlite);
    const db = await hashFile(snapshotFile);

    const missing: string[] = [];
    const collect = async (area: StoredArea, rows: SnapshotInfo['attachments']) => {
      const found: Array<BackupManifestType['attachments'][number] & { file: string }> = [];
      for (const row of rows) {
        const file = await containedDataFile(deps.dataDir, area, row.path).catch(() => null);
        if (!file) {
          deps.logger.warn(`backup: ${area} file missing or unsafe id=${row.id}`);
          missing.push(row.id);
          continue;
        }
        found.push({ id: row.id, path: row.path, ...(await hashFile(file)), file });
      }
      return found;
    };
    const attachments = await collect('attachments', info.attachments);
    const documents = await collect('documents', info.documents);
    const entry = ({ id, path: p, sha256, size }: BackupManifestType['attachments'][number]) => ({ id, path: p, sha256, size });

    const manifest: BackupManifestType = {
      format: BACKUP_FORMAT,
      formatVersion: ARCHIVE_FORMAT_VERSION,
      appVersion: deps.appVersion,
      schemaVersion: info.schemaVersion,
      createdAt: deps.now(),
      notes: info.notes,
      db: { path: BACKUP_DB_ENTRY, ...db },
      attachments: attachments.map(entry),
      documents: documents.map(entry),
      missing,
    };
    // The database and stored files are kept uncompressed: images and Office files are compressed already, and a stored
    // entry can never trip the restore's compression-ratio guard.
    const items: ArchiveItem[] = [
      { name: MANIFEST_ENTRY, buffer: Buffer.from(JSON.stringify(manifest, null, 2)), compress: true },
      { name: BACKUP_DB_ENTRY, file: snapshotFile, compress: false },
      ...[...attachments, ...documents].map((a) => ({ name: a.path, file: a.file, compress: false })),
    ];
    await writeArchive(destFile, items);
    const { size } = await fs.promises.stat(destFile);
    deps.logger.info(`backup: written notes=${info.notes} attachments=${attachments.length} documents=${documents.length} missing=${missing.length} bytes=${size}`);
    return { sizeBytes: size, notes: info.notes, attachments: attachments.length };
  } catch (err) {
    deps.logger.error(`backup: failed ${errorDetail(err)}`);
    throw err;
  } finally {
    await fs.promises.rm(work, { recursive: true, force: true });
  }
}
