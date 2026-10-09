import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { PORTABILITY_MESSAGES } from '../../shared/contracts/portability';
import { AppError } from '../services/app-error';

/** Preflight limits for archives read by restore and import (ARCHITECTURE section 13). */
export interface ArchiveLimits {
  maxEntries: number;
  /** Sum of the declared uncompressed sizes. */
  maxTotalBytes: number;
  /** Uncompressed / compressed ratio allowed for one entry ... */
  maxRatio: number;
  /** ... once the entry is larger than this (small entries cannot be bombs). */
  ratioFloorBytes: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 200_000,
  maxTotalBytes: 4 * 1024 ** 3,
  maxRatio: 100,
  ratioFloorBytes: 1024 * 1024,
};

export type RefusalReason = 'notArchive' | 'unsafe' | 'tooLarge';

/** An archive that must not be read further; `detail` goes to the log only. */
export class ArchiveRefused extends Error {
  constructor(
    readonly reason: RefusalReason,
    readonly detail: string,
  ) {
    super(`archive refused (${reason}): ${detail}`);
    this.name = 'ArchiveRefused';
  }
}

/** The message the user sees for a refused archive. */
export function refusalError(err: ArchiveRefused): AppError {
  return new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES[err.reason]);
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const STORED = 0;
const DEFLATED = 8;

/** Why an entry name is unsafe, or null. Names are relative, forward-slash, NFC paths without `.` or `..` segments. */
export function entryNameProblem(name: string): string | null {
  if (name.length === 0 || name.length > 512) return 'name length';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\\]/.test(name)) return 'control character or backslash';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'absolute path';
  if (name.normalize('NFC') !== name) return 'not NFC';
  const segments = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return 'relative segment';
  return null;
}

export interface OpenedArchive {
  /** File entries by name (directories are not listed). */
  readonly names: ReadonlySet<string>;
  size(name: string): number;
  /** Reads one entry into memory; refused when it is larger than `maxBytes`. */
  read(name: string, maxBytes: number): Promise<Buffer>;
  /** Streams one entry into a new file and returns its SHA-256 and size. */
  extractTo(name: string, file: string): Promise<{ sha256: string; size: number }>;
  close(): void;
}

function checkEntry(entry: yauzl.Entry, limits: ArchiveLimits): void {
  const problem = entryNameProblem(entry.fileName);
  if (problem) throw new ArchiveRefused('unsafe', `${problem}: ${JSON.stringify(entry.fileName)}`);
  if (((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) throw new ArchiveRefused('unsafe', `symbolic link: ${entry.fileName}`);
  if (entry.isEncrypted()) throw new ArchiveRefused('unsafe', `encrypted: ${entry.fileName}`);
  if (entry.compressionMethod !== STORED && entry.compressionMethod !== DEFLATED) {
    throw new ArchiveRefused('unsafe', `compression method ${entry.compressionMethod}: ${entry.fileName}`);
  }
  const ratioLimit = Math.max(entry.compressedSize, 1) * limits.maxRatio;
  if (entry.uncompressedSize > limits.ratioFloorBytes && entry.uncompressedSize > ratioLimit) {
    throw new ArchiveRefused('tooLarge', `compression ratio: ${entry.fileName}`);
  }
}

/**
 * Opens a zip for reading after a full preflight of its central directory: entry count, every name, symlink
 * attributes, encryption, compression method, the declared total and each entry's compression ratio. yauzl also
 * enforces that each entry's data matches its declared size, so the declared total bounds what can be extracted.
 */
export async function openArchive(file: string, limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS): Promise<OpenedArchive> {
  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.openPromise(file, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true, strictFileNames: true });
  } catch (err) {
    throw new ArchiveRefused('notArchive', String(err));
  }
  const entries = new Map<string, yauzl.Entry>();
  try {
    if (zip.entryCount > limits.maxEntries) throw new ArchiveRefused('tooLarge', `entry count ${zip.entryCount}`);
    let total = 0;
    try {
      for await (const entry of zip.eachEntry()) {
        checkEntry(entry, limits);
        if (entry.fileName.endsWith('/')) continue;
        if (entries.has(entry.fileName)) throw new ArchiveRefused('unsafe', `duplicate entry: ${entry.fileName}`);
        total += entry.uncompressedSize;
        if (total > limits.maxTotalBytes) throw new ArchiveRefused('tooLarge', `declared size over ${limits.maxTotalBytes}`);
        entries.set(entry.fileName, entry);
      }
    } catch (err) {
      // yauzl's own name validation (absolute or `..` paths, backslashes) and structural errors end up here.
      throw err instanceof ArchiveRefused ? err : new ArchiveRefused('unsafe', String(err));
    }
  } catch (err) {
    zip.close();
    throw err;
  }

  const entryOf = (name: string): yauzl.Entry => {
    const entry = entries.get(name);
    if (!entry) throw new ArchiveRefused('unsafe', `missing entry: ${name}`);
    return entry;
  };
  const stream = async (name: string) => {
    try {
      return await zip.openReadStreamPromise(entryOf(name));
    } catch (err) {
      throw err instanceof ArchiveRefused ? err : new ArchiveRefused('unsafe', String(err));
    }
  };
  return {
    names: new Set(entries.keys()),
    size: (name) => entryOf(name).uncompressedSize,
    async read(name, maxBytes) {
      if (entryOf(name).uncompressedSize > maxBytes) throw new ArchiveRefused('tooLarge', `${name} over ${maxBytes} bytes`);
      const chunks: Buffer[] = [];
      for await (const chunk of await stream(name)) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    },
    async extractTo(name, target) {
      const hash = createHash('sha256');
      let size = 0;
      const tap = new Transform({
        transform(chunk: Buffer, _enc, done) {
          hash.update(chunk);
          size += chunk.length;
          done(null, chunk);
        },
      });
      const out = fs.createWriteStream(target, { flags: 'wx' });
      try {
        await pipeline(await stream(name), tap, out);
      } catch (err) {
        throw err instanceof ArchiveRefused ? err : new ArchiveRefused('unsafe', `${name}: ${String(err)}`);
      }
      return { sha256: hash.digest('hex'), size };
    },
    close: () => zip.close(),
  };
}

export type ArchiveItem = { name: string; compress: boolean } & ({ buffer: Buffer } | { file: string });

/** Writes a zip next to `file` and renames it into place once complete, so a failure never leaves a partial archive. */
export async function writeArchive(file: string, items: readonly ArchiveItem[]): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const item of items) {
    if ('buffer' in item) zip.addBuffer(item.buffer, item.name, { compress: item.compress });
    else zip.addFile(item.file, item.name, { compress: item.compress });
  }
  zip.end();
  const part = `${file}.part`;
  try {
    await pipeline(zip.outputStream, fs.createWriteStream(part, { flags: 'w' }));
    const handle = await fs.promises.open(part, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(part, file);
  } catch (err) {
    await fs.promises.rm(part, { force: true });
    throw err;
  }
}

/** SHA-256 and size of a file, streamed. */
export async function hashFile(file: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha256: hash.digest('hex'), size };
}
