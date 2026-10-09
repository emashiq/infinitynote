import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PORTABILITY_MESSAGES, type BackupSummaryType, type RestoreOutcomeType } from '../../shared/contracts/portability';
import type { DataPaths } from '../app-paths';
import { openBetterSqlite } from '../db/better-sqlite3-driver';
import type { Db, OpenOptions } from '../db/driver';
import type { DbOpenResult } from '../db/open-database';
import { AppError, errorDetail } from '../services/app-error';
import type { Logger } from '../services/logger';
import { BACKUP_DB_ENTRY, MANIFEST_ENTRY, MAX_MANIFEST_BYTES, parseBackupManifest, type BackupManifestType } from './backup-manifest';
import { ArchiveRefused, DEFAULT_ARCHIVE_LIMITS, hashFile, openArchive, refusalError, type ArchiveLimits, type OpenedArchive } from './zip-archive';

export type RestorePaths = Pick<DataPaths, 'dataDir' | 'dbFile' | 'attachmentsDir' | 'restoreStagingDir' | 'restorePendingFile'>;

const ROLLBACK_PREFIX = 'rollback-';
const ROLLBACK_RE = /^rollback-(\d{8}T\d{6}Z)$/;
const WAL_SUFFIXES = ['-wal', '-shm'] as const;

function stagedDbFile(staging: string): string {
  return path.join(staging, ...BACKUP_DB_ENTRY.split('/'));
}

/** Hashes every staged file against the manifest. */
async function verifyStagedFiles(staging: string, manifest: BackupManifestType): Promise<boolean> {
  const files = [{ path: BACKUP_DB_ENTRY, sha256: manifest.db.sha256, size: manifest.db.size }, ...manifest.attachments];
  for (const f of files) {
    const actual = await hashFile(path.join(staging, ...f.path.split('/'))).catch(() => null);
    if (!actual || actual.sha256 !== f.sha256 || actual.size !== f.size) return false;
  }
  return true;
}

/** Opens the staged database read-only: integrity, schema and attachment rows must match the manifest. */
function checkStagedDatabase(file: string, manifest: BackupManifestType, latestSchema: number, open: (f: string, o: OpenOptions) => Db): void {
  let db: Db;
  try {
    db = open(file, { readonly: true, fileMustExist: true });
  } catch {
    throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.databaseDamaged);
  }
  try {
    const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.databaseDamaged);
    const version = Number(db.pragmaValue('user_version'));
    if (version > latestSchema) throw new AppError('UNSUPPORTED', PORTABILITY_MESSAGES.newerSchema);
    if (version !== manifest.schemaVersion) throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.databaseDamaged);
    const listed = new Set([...manifest.attachments.map((a) => a.id), ...manifest.missing]);
    const rows = db.prepare<[], { id: string }>('SELECT id FROM attachments').all();
    if (rows.some((r) => !listed.has(r.id))) throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.databaseDamaged);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.databaseDamaged);
  } finally {
    db.close();
  }
}

async function extractVerified(archive: OpenedArchive, staging: string, entry: { path: string; sha256: string; size: number }): Promise<void> {
  const target = path.join(staging, ...entry.path.split('/'));
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const actual = await archive.extractTo(entry.path, target);
  if (actual.sha256 !== entry.sha256 || actual.size !== entry.size) throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.damaged);
}

export interface PrepareRestoreOptions {
  paths: RestorePaths;
  latestSchema: number;
  logger: Logger;
  limits?: ArchiveLimits;
  open?: (file: string, opts: OpenOptions) => Db;
}

/**
 * Restore, step 1 (INF-PORT-02): preflight the archive, extract it into `restore-staging/`, verify every hash, and check
 * the staged database read-only. The live data is not touched; any failure removes the staging directory.
 */
export async function prepareRestore(archiveFile: string, opts: PrepareRestoreOptions): Promise<BackupSummaryType> {
  const staging = opts.paths.restoreStagingDir;
  await fs.promises.rm(staging, { recursive: true, force: true });
  await fs.promises.rm(opts.paths.restorePendingFile, { force: true });
  let archive: OpenedArchive | null = null;
  try {
    archive = await openArchive(archiveFile, opts.limits ?? DEFAULT_ARCHIVE_LIMITS);
    if (!archive.names.has(MANIFEST_ENTRY)) throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.notArchive);
    const manifest = parseBackupManifest(await archive.read(MANIFEST_ENTRY, MAX_MANIFEST_BYTES));
    if (manifest.schemaVersion > opts.latestSchema) throw new AppError('UNSUPPORTED', PORTABILITY_MESSAGES.newerSchema);
    const expected = new Set([MANIFEST_ENTRY, BACKUP_DB_ENTRY, ...manifest.attachments.map((a) => a.path)]);
    if (archive.names.size !== expected.size || [...archive.names].some((n) => !expected.has(n))) {
      throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.unsafe);
    }
    await fs.promises.mkdir(staging, { recursive: true });
    await extractVerified(archive, staging, manifest.db);
    for (const attachment of manifest.attachments) await extractVerified(archive, staging, attachment);
    checkStagedDatabase(stagedDbFile(staging), manifest, opts.latestSchema, opts.open ?? openBetterSqlite);
    await fs.promises.writeFile(path.join(staging, MANIFEST_ENTRY), JSON.stringify(manifest));
    opts.logger.info(`restore: staged schema=${manifest.schemaVersion} notes=${manifest.notes} attachments=${manifest.attachments.length}`);
    return {
      createdAt: manifest.createdAt,
      appVersion: manifest.appVersion,
      schemaVersion: manifest.schemaVersion,
      notes: manifest.notes,
      attachments: manifest.attachments.length,
    };
  } catch (err) {
    opts.logger.warn(`restore: refused ${errorDetail(err)}`);
    await fs.promises.rm(staging, { recursive: true, force: true });
    if (err instanceof ArchiveRefused) throw refusalError(err);
    throw err;
  } finally {
    archive?.close();
  }
}

/** The marker that makes the next start apply the staged backup; `swapping` names the rollback copy in use. */
const PendingMarker = z.strictObject({ preparedAt: z.number().int(), swapping: z.string().regex(ROLLBACK_RE).nullable() });
type PendingMarkerType = z.infer<typeof PendingMarker>;

async function writeMarker(file: string, marker: PendingMarkerType): Promise<void> {
  const part = `${file}.part`;
  await fs.promises.writeFile(part, JSON.stringify(marker));
  await fs.promises.rename(part, file);
}

/** Restore, step 2: a staged backup is scheduled for the next start (the caller then restarts the app). */
export async function scheduleRestore(paths: RestorePaths, now: number): Promise<void> {
  if (!fs.existsSync(path.join(paths.restoreStagingDir, MANIFEST_ENTRY))) throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.noPrepared);
  await writeMarker(paths.restorePendingFile, { preparedAt: now, swapping: null });
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** The live files a restore replaces, as [live path, name inside the rollback copy]. */
function liveItems(paths: RestorePaths): Array<[string, string]> {
  const db = path.basename(paths.dbFile);
  return [[paths.dbFile, db], ...WAL_SUFFIXES.map((s): [string, string] => [`${paths.dbFile}${s}`, `${db}${s}`]), [paths.attachmentsDir, 'attachments']];
}

/** Moves the live data into the rollback copy, then the staged data into place. */
async function swapIn(paths: RestorePaths, rollbackDir: string, move: MoveFn): Promise<void> {
  await fs.promises.mkdir(rollbackDir, { recursive: true });
  for (const [live, name] of liveItems(paths)) {
    if (fs.existsSync(live)) await move(live, path.join(rollbackDir, name));
  }
  const staging = paths.restoreStagingDir;
  await move(stagedDbFile(staging), paths.dbFile);
  const stagedAttachments = path.join(staging, 'attachments');
  if (fs.existsSync(stagedAttachments)) await move(stagedAttachments, paths.attachmentsDir);
  await fs.promises.mkdir(path.join(paths.attachmentsDir, 'tmp'), { recursive: true });
}

/**
 * Removes whatever the restore put in place and moves the rollback copy back. Works from the files alone, so it also
 * repairs a swap interrupted by a crash: the staged database moves in first and only after every live item moved out,
 * so while it is still in staging nothing was moved in, and a live item without a saved copy is original data.
 */
async function rollBack(paths: RestorePaths, rollbackDir: string): Promise<void> {
  const movedIn = !fs.existsSync(stagedDbFile(paths.restoreStagingDir));
  for (const [live, name] of liveItems(paths)) {
    const saved = path.join(rollbackDir, name);
    if (fs.existsSync(saved)) {
      await fs.promises.rm(live, { recursive: true, force: true });
      await fs.promises.rename(saved, live);
    } else if (movedIn) {
      // Nothing of this kind existed before the restore (a WAL file, or attachments in a new profile).
      await fs.promises.rm(live, { recursive: true, force: true });
    }
  }
  await fs.promises.rm(rollbackDir, { recursive: true, force: true });
}

export type MoveFn = (from: string, to: string) => Promise<void>;

export interface PendingRestoreOptions {
  paths: RestorePaths;
  /** Opens (and migrates) the live database; called once, or twice when the restored copy fails to open. */
  openDatabase: () => Promise<DbOpenResult>;
  logger: Logger;
  now?: () => Date;
  /** Test seam for the file moves (fault injection). */
  move?: MoveFn;
}

export interface PendingRestoreResult {
  opened: DbOpenResult;
  restore: RestoreOutcomeType | null;
}

function readMarker(file: string): PendingMarkerType | null | 'invalid' {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = PendingMarker.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : 'invalid';
  } catch {
    return 'invalid';
  }
}

/**
 * Restore, step 3, at startup before anything uses the database: re-verifies the staged files, moves the live data to
 * `rollback-<stamp>/`, moves the staged data into place and opens it (an older schema migrates forward). If any step
 * fails, or the app stopped in the middle of a swap last time, the rollback copy is moved back and the previous data
 * opens unchanged. The rollback copy of a successful restore is kept until the user deletes it in Settings.
 */
export async function openWithPendingRestore(opts: PendingRestoreOptions): Promise<PendingRestoreResult> {
  const { paths, logger } = opts;
  const marker = readMarker(paths.restorePendingFile);
  if (marker === null) {
    // A restore prepared but never confirmed leaves its staging copy behind (A08-F2); without a marker it is unused.
    await fs.promises.rm(paths.restoreStagingDir, { recursive: true, force: true });
    return { opened: await opts.openDatabase(), restore: null };
  }
  const failed = (detail: string): RestoreOutcomeType => {
    logger.error(`restore: failed ${detail}`);
    return { status: 'failed', message: PORTABILITY_MESSAGES.restoreFailed };
  };
  const finish = async () => {
    await fs.promises.rm(paths.restorePendingFile, { force: true });
    await fs.promises.rm(paths.restoreStagingDir, { recursive: true, force: true });
  };

  if (marker === 'invalid' || marker.swapping !== null) {
    // An interrupted swap: put the previous data back before anything opens it.
    if (marker !== 'invalid' && marker.swapping !== null) await rollBack(paths, path.join(paths.dataDir, marker.swapping));
    await finish();
    return { opened: await opts.openDatabase(), restore: failed('interrupted restore rolled back') };
  }

  let manifest: BackupManifestType;
  try {
    manifest = parseBackupManifest(await fs.promises.readFile(path.join(paths.restoreStagingDir, MANIFEST_ENTRY)));
    if (!(await verifyStagedFiles(paths.restoreStagingDir, manifest))) throw new Error('staged files changed since they were verified');
  } catch (err) {
    await finish();
    return { opened: await opts.openDatabase(), restore: failed(errorDetail(err)) };
  }

  const rollbackName = `${ROLLBACK_PREFIX}${stamp((opts.now ?? (() => new Date()))())}`;
  const rollbackDir = path.join(paths.dataDir, rollbackName);
  try {
    await writeMarker(paths.restorePendingFile, { preparedAt: marker.preparedAt, swapping: rollbackName });
    await swapIn(paths, rollbackDir, opts.move ?? ((from, to) => fs.promises.rename(from, to)));
  } catch (err) {
    await rollBack(paths, rollbackDir);
    await finish();
    return { opened: await opts.openDatabase(), restore: failed(`swap: ${errorDetail(err)}`) };
  }

  const opened = await opts.openDatabase();
  if (opened.ok) {
    await finish();
    logger.info(`restore: applied backup notes=${manifest.notes} attachments=${manifest.attachments.length} rollback=${rollbackName}`);
    return { opened, restore: { status: 'restored', message: PORTABILITY_MESSAGES.restored } };
  }
  await rollBack(paths, rollbackDir);
  await finish();
  return { opened: await opts.openDatabase(), restore: failed(`open: ${opened.code} ${opened.detail}`) };
}

/** Rollback copies kept by earlier restores, newest first. */
export function listRollbackCopies(dataDir: string): Array<{ name: string; createdAt: number }> {
  let names: string[];
  try {
    names = fs.readdirSync(dataDir);
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const m = ROLLBACK_RE.exec(name);
      if (!m) return null;
      const iso = m[1]!.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
      return { name, createdAt: Date.parse(iso) };
    })
    .filter((c): c is { name: string; createdAt: number } => c !== null && Number.isFinite(c.createdAt))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Deletes every rollback copy (Settings > Backup). */
export async function deleteRollbackCopies(dataDir: string): Promise<void> {
  for (const copy of listRollbackCopies(dataDir)) await fs.promises.rm(path.join(dataDir, copy.name), { recursive: true, force: true });
}
