import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DocumentKind } from '../../shared/documents/kinds';
import { DOCUMENT_MESSAGES } from '../../shared/documents/messages';
import { AppError } from '../services/app-error';
import { copyNewFileDurably, moveIntoPlace, writeNewFileDurably } from '../services/stored-files';
import { isDocumentOfKind } from './document-check';

/** Rename errors that mean another program holds the file or the folder refuses the change. */
const IN_USE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

/**
 * Writes a document file outside the app's data atomically (D-118): the bytes go to a temporary file in the same folder,
 * are checked to be a document of the kind, and replace the target by a rename, so the target is never half written.
 * An existing target's permission bits are kept on Linux. Returns the written file's state.
 */
export function writeDocumentFile(target: string, kind: DocumentKind, bytes: Uint8Array): Promise<fs.Stats> {
  return placeDocumentFile(target, kind, (temp) => writeNewFileDurably(temp, bytes));
}

/** Copies a document file main chose (a stored blob, a linked original) to a target the same atomic way. */
export function copyDocumentFile(source: string, target: string, kind: DocumentKind): Promise<fs.Stats> {
  return placeDocumentFile(target, kind, (temp) => copyNewFileDurably(source, temp));
}

async function placeDocumentFile(target: string, kind: DocumentKind, writeTemp: (temp: string) => Promise<void>): Promise<fs.Stats> {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeTemp(temp);
    if (!(await isDocumentOfKind(kind, temp))) throw new AppError('VALIDATION_FAILED', DOCUMENT_MESSAGES.damaged(kind));
    if (process.platform !== 'win32') {
      const previous = await fs.promises.stat(target).catch(() => null);
      if (previous) await fs.promises.chmod(temp, previous.mode & 0o777);
    }
    try {
      await moveIntoPlace(temp, target);
    } catch (err) {
      if (IN_USE_CODES.has((err as NodeJS.ErrnoException).code ?? '')) throw new AppError('CONFLICT', DOCUMENT_MESSAGES.inUse, { reason: 'inUse' });
      throw err;
    }
    return await fs.promises.stat(target);
  } finally {
    await fs.promises.rm(temp, { force: true });
  }
}
