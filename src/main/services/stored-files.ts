import fs from 'node:fs';
import path from 'node:path';
import { isInside } from '../app-paths';
import { errorDetail } from './app-error';
import type { Logger } from './logger';

/** The directories under `<userData>/data` that hold files the app stored itself. */
export type StoredArea = 'attachments' | 'documents';

/**
 * The real path of a stored file, or null when it breaks containment: it must be a regular file (not a symbolic link)
 * whose real path is inside the real area directory, so a link or junction placed there never exposes or launches
 * anything else (F-01-2, INF-REF-08). Rejects when the file cannot be read.
 */
export async function containedDataFile(dataDir: string, area: StoredArea, relativePath: string): Promise<string | null> {
  const root = path.join(dataDir, area);
  const abs = path.resolve(dataDir, relativePath);
  if (!isInside(root, abs)) return null;
  const stat = await fs.promises.lstat(abs);
  if (stat.isSymbolicLink() || !stat.isFile()) return null;
  const [realRoot, real] = await Promise.all([fs.promises.realpath(root), fs.promises.realpath(abs)]);
  return isInside(realRoot, real) ? real : null;
}

/** Writes a new file and fsyncs it; fails when the file already exists. */
export async function writeNewFileDurably(file: string, bytes: Uint8Array): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.promises.open(file, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Copies a file to a new file (never over an existing one) and syncs it, as writeNewFileDurably does for bytes. */
export async function copyNewFileDurably(source: string, file: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.copyFile(source, file, fs.constants.COPYFILE_EXCL);
  const handle = await fs.promises.open(file, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Renames a completed file into place (atomic on one file system) and, on Linux, syncs the directory entry. */
export async function moveIntoPlace(from: string, to: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  await fs.promises.rename(from, to);
  if (process.platform === 'linux') await fsyncDirectory(path.dirname(to));
}

async function fsyncDirectory(dir: string): Promise<void> {
  try {
    const handle = await fs.promises.open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Best effort: some file systems refuse fsync on directories.
  }
}

/** Removes leftovers of interrupted writes older than `maxAgeMs` from a temporary directory; returns how many. */
export async function sweepStaleFiles(dir: string, now: number, maxAgeMs: number, logger: Logger, label: string): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    const file = path.join(dir, entry);
    try {
      const stat = await fs.promises.lstat(file);
      if (stat.mtimeMs < now - maxAgeMs) {
        await fs.promises.rm(file, { recursive: true, force: true });
        removed += 1;
      }
    } catch (err) {
      logger.warn(`${label}: tmp sweep skipped ${entry}: ${errorDetail(err)}`);
    }
  }
  return removed;
}
