import fs from 'node:fs';
import path from 'node:path';
import { extensionFor, isOpenableExtension } from '../../shared/attachments/names';
import type { LinkedFileStateType } from '../../shared/contracts/attachments';

/** Windows: a local drive path (`C:\…`). */
const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:\\/;

/**
 * Whether a path names a network or device location on Windows: a UNC share (`\\server\share`, `//server/share`), a
 * WebDAV share in UNC form (`\\host@SSL\DavWWWRoot\…`) or a `\\?\` / `\\.\` device path. Touching one (even a `stat`)
 * makes Windows connect to the host and offer the user's credentials, so such paths are never linked (D-115).
 */
export function isNetworkPath(p: string): boolean {
  return /^[\\/]{2}/.test(p);
}

/**
 * A stored path main may act on (D-108, D-115): absolute, already normalized, and on Windows a local drive path without
 * a second colon, since `file.pdf:stream` names an NTFS stream that could hide a program behind a document's name.
 * Network and device paths are refused before any file system call. Paths from another system (a backup restored on
 * another OS) fail this and show as missing.
 */
export function isUsableLinkPath(p: string, platform: NodeJS.Platform = process.platform): boolean {
  if (p.includes('\0')) return false;
  if (platform === 'win32') return WINDOWS_DRIVE_ROOT.test(p) && path.win32.normalize(p) === p && !p.includes(':', 2);
  return path.posix.isAbsolute(p) && path.posix.normalize(p) === p;
}

export interface LinkedFileCheck {
  state: LinkedFileStateType;
  sizeBytes: number | null;
  /** The resolved file (symbolic links followed) for an existing file. */
  real: string | null;
}

const MISSING: LinkedFileCheck = { state: 'missing', sizeBytes: null, real: null };

/**
 * Whether a linked file may be handed to the OS to open (INF-REF-08): a known document or image type by the link's
 * name and by the name of the file it resolves to, and on Linux never a file marked executable. Programs, scripts,
 * shortcuts (.exe, .bat, .cmd, .ps1, .vbs, .js, .msi, .lnk, .sh, .desktop, .AppImage, …) and unknown types are not.
 */
function isLaunchable(link: string, real: string, mode: number, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32' && (mode & 0o111) !== 0) return false;
  return isOpenableExtension(extensionFor(link)) && isOpenableExtension(extensionFor(real));
}

/** Checks a stored link at the moment it is used: missing (not a usable path, gone or not a file), blocked or available. */
export async function inspectLinkedFile(link: string, platform: NodeJS.Platform = process.platform): Promise<LinkedFileCheck> {
  if (!isUsableLinkPath(link, platform)) return MISSING;
  let real: string;
  let stat: fs.Stats;
  try {
    real = await fs.promises.realpath(link);
    stat = await fs.promises.stat(real);
  } catch {
    return MISSING;
  }
  if (!stat.isFile()) return MISSING;
  return { state: isLaunchable(link, real, stat.mode, platform) ? 'available' : 'blocked', sizeBytes: stat.size, real };
}
