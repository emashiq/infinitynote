import fs from 'node:fs';
import path from 'node:path';
import { isInside } from '../app-paths';

/**
 * The real path of a stored attachment file, or null when it breaks containment: it must be a regular file (not a
 * symbolic link) whose real path is inside the real attachments directory, so a link or junction placed under
 * attachments/ never exposes or launches anything else (F-01-2, INF-REF-08). Rejects when the file cannot be read.
 */
export async function containedAttachmentFile(dataDir: string, relativePath: string): Promise<string | null> {
  const root = path.join(dataDir, 'attachments');
  const abs = path.resolve(dataDir, relativePath);
  if (!isInside(root, abs)) return null;
  const stat = await fs.promises.lstat(abs);
  if (stat.isSymbolicLink() || !stat.isFile()) return null;
  const [realRoot, real] = await Promise.all([fs.promises.realpath(root), fs.promises.realpath(abs)]);
  return isInside(realRoot, real) ? real : null;
}
