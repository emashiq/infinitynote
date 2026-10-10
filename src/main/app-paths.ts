import fs from 'node:fs';
import path from 'node:path';

export type UserDataOverride = { dir: string } | { ignored: string } | null;

/**
 * INFINITY_NOTES_USER_DATA_DIR handling (D-037). Independent of isPackaged: only an absolute,
 * NUL-free path is accepted; anything else is ignored with a reason.
 */
export function resolveUserDataOverride(raw: string | undefined): UserDataOverride {
  if (raw === undefined) return null;
  if (raw.trim() === '') return { ignored: 'empty value' };
  if (raw.includes('\0')) return { ignored: 'contains a NUL character' };
  if (!path.isAbsolute(raw)) return { ignored: 'not an absolute path' };
  return { dir: path.normalize(raw) };
}

export interface DataPaths {
  dataDir: string;
  dbFile: string;
  attachmentsDir: string;
  attachmentsTmp: string;
  /** Stored document bytes (D-118). */
  documentsDir: string;
  documentsTmp: string;
  preMigrationDir: string;
  /** A verified backup waiting to replace the live data at the next start (D-099). */
  restoreStagingDir: string;
  restorePendingFile: string;
  logsDir: string;
}

export function resolveDataPaths(userData: string): DataPaths {
  const dataDir = path.join(userData, 'data');
  return {
    dataDir,
    dbFile: path.join(dataDir, 'infinity-notes.sqlite3'),
    attachmentsDir: path.join(dataDir, 'attachments'),
    attachmentsTmp: path.join(dataDir, 'attachments', 'tmp'),
    documentsDir: path.join(dataDir, 'documents'),
    documentsTmp: path.join(dataDir, 'documents', 'tmp'),
    preMigrationDir: path.join(dataDir, 'pre-migration'),
    restoreStagingDir: path.join(dataDir, 'restore-staging'),
    restorePendingFile: path.join(dataDir, 'restore-pending.json'),
    logsDir: path.join(userData, 'logs'),
  };
}

export function ensureDataDirs(paths: DataPaths): void {
  for (const dir of [paths.dataDir, paths.attachmentsDir, paths.attachmentsTmp, paths.documentsDir, paths.documentsTmp, paths.preMigrationDir, paths.logsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const PARENT_RE = /^\.\.(?:[\\/]|$)/;

/** Containment check shared by the protocol handlers: true if child is strictly inside parent. */
export function isInside(parent: string, child: string, platform: NodeJS.Platform = process.platform): boolean {
  const norm = (p: string) => (platform === 'win32' ? p.toLowerCase() : p);
  const pathApi = platform === 'win32' ? path.win32 : path;
  const rel = pathApi.relative(norm(pathApi.resolve(parent)), norm(pathApi.resolve(child)));
  return rel !== '' && !PARENT_RE.test(rel) && !pathApi.isAbsolute(rel);
}

export function assertNotInstallDir(dataDir: string, installDir: string, platform: NodeJS.Platform = process.platform): void {
  const norm = (p: string) => (platform === 'win32' ? p.toLowerCase() : p);
  const pathApi = platform === 'win32' ? path.win32 : path;
  const rel = pathApi.relative(norm(pathApi.resolve(installDir)), norm(pathApi.resolve(dataDir)));
  const inside = rel === '' || (!PARENT_RE.test(rel) && !pathApi.isAbsolute(rel));
  if (inside) throw new Error('User data must not be stored inside the installation directory');
}

/**
 * Resolves a relative path under root and returns the absolute path, or null if it escapes root
 * (parent segments, absolute paths, or sibling directories sharing a name prefix).
 */
export function resolveContained(root: string, relative: string): string | null {
  if (relative.includes('\0')) return null;
  const abs = path.resolve(root, relative);
  return isInside(root, abs) ? abs : null;
}
