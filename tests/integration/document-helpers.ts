import fs from 'node:fs';
import path from 'node:path';
import type { LocationType } from '../../src/shared/contracts/hierarchy';
import { setupServices, type Services } from './hierarchy-helpers';
import { mkTmp } from './helpers';

export const CTX = { webContentsId: 1 };
export const COMMON: LocationType = { projectId: null, folderId: null };
export const FIXTURES = path.resolve('tests/fixtures/documents');
export const fixtureBytes = (name: string): Buffer => fs.readFileSync(path.join(FIXTURES, name));

/** Runs a call that must fail and returns its AppError-like shape. */
export async function rejection(p: Promise<unknown>): Promise<{ code: string; message: string; details?: unknown }> {
  try {
    await p;
  } catch (err) {
    return err as { code: string; message: string; details?: unknown };
  }
  throw new Error('expected a rejection');
}

/** The production services, plus a folder of original files outside the app's data (for links and imports). */
export async function setupDocuments(opts: Parameters<typeof setupServices>[0] = {}) {
  const s = await setupServices(opts);
  const originals = fs.realpathSync.native(mkTmp('infinity-originals-'));
  const original = (name: string, bytes: Buffer | string = fixtureBytes(`sample${path.extname(name)}`)) => {
    const file = path.join(originals, name);
    fs.writeFileSync(file, bytes);
    return file;
  };
  /** Picks files in the native picker and adds the first one as a document. */
  const importFile = async (file: string, action: 'copy' | 'link', location: LocationType = COMMON) => {
    s.dialogQueue.push([file]);
    const pick = await s.documents.pickFiles(CTX);
    if (pick.pickId === null || pick.files.length === 0) throw new Error(`nothing picked: ${JSON.stringify(pick.rejected)}`);
    return (await s.documents.addPicked({ pickId: pick.pickId, index: 0, action, location }, CTX)).document;
  };
  const documentRow = (id: string) =>
    s.row<{ revision: number; blob_id: string | null; linked_file_id: string | null; size_bytes: number; body_text: string; deleted_at: number | null; trash_batch_id: string | null }>(
      'SELECT revision, blob_id, linked_file_id, size_bytes, body_text, deleted_at, trash_batch_id FROM documents WHERE id = ?',
      id,
    );
  const blobFile = (blobId: string) => path.join(s.dataDir, s.row<{ relative_path: string }>('SELECT relative_path FROM document_blobs WHERE id = ?', blobId)!.relative_path);
  return { s, originals, original, importFile, documentRow, blobFile };
}

export type DocumentSetup = Awaited<ReturnType<typeof setupDocuments>>;
export type { Services };
