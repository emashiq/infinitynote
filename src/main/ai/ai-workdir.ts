import fs from 'node:fs';
import path from 'node:path';
import type { FileDelivery } from './ai-prompt';
import { EngineError } from './engines/engine';

/**
 * Runs a command-line tool's turn in its thread's working folder (D-192): `<root>/<threadId>`, made fresh with only the
 * copies of the files sent with the turn, and removed afterwards whatever happened. The path stays the same for every
 * turn of a thread, because the tools keep their sessions by working folder and a follow-up resumes there. The root is
 * the user's own (`<userData>/ai-work`); folders are made 0700 and copies 0600, so no other account can read them.
 */
export async function withWorkDir<T>(root: string, threadId: string, files: readonly FileDelivery[], run: (dir: string) => Promise<T>): Promise<T> {
  await ensurePrivateRoot(root);
  const dir = path.join(root, threadId);
  await removeDir(dir);
  await fs.promises.mkdir(dir, { mode: 0o700 });
  try {
    for (const d of files) {
      if (d.how !== 'folder') continue;
      await fs.promises.writeFile(path.join(dir, d.workName), d.file.extracted && d.file.text !== null ? d.file.text : d.file.bytes, { flag: 'wx', mode: 0o600 });
    }
    return await run(dir);
  } finally {
    await removeDir(dir);
  }
}

/**
 * Makes the work root, or checks the one there: a real folder (not a link), and where the OS has owners (`uid` is
 * undefined on Windows, whose profile folder is the user's alone) owned by this account, with its mode narrowed to
 * 0700. A folder another account made is refused rather than used.
 */
export async function ensurePrivateRoot(root: string, uid: number | undefined = process.getuid?.()): Promise<void> {
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await fs.promises.lstat(root);
  if (!stat.isDirectory()) throw new EngineError('The AI working folder is not a folder. Remove it and try again.');
  if (uid === undefined) return;
  if (stat.uid !== uid) throw new EngineError('The AI working folder belongs to another account, so it is not used.');
  if ((stat.mode & 0o077) !== 0) await fs.promises.chmod(root, 0o700);
}

/** A tool that was just ended may still hold a file for a moment on Windows, so removal retries. */
export function removeDir(dir: string): Promise<void> {
  return fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/**
 * Removes the whole work root at once (D-195): at startup, the folders a quit, crash or power cut left during a run; when
 * the app quits, those of the runs it just stopped. Synchronous, so it is done before anything runs or the process
 * exits; a file a stopped tool still holds on Windows stays until the next start. Returns the number of folders.
 */
export function removeWorkRoot(root: string): number {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return 0;
  }
  fs.rmSync(root, { recursive: true, force: true });
  return entries.length;
}
