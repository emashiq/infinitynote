import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DOCUMENT_KIND_INFO, type DocumentKind } from '../../shared/documents/kinds';
import { DOCUMENT_MESSAGES } from '../../shared/documents/messages';
import type { Db } from '../db/driver';
import { DocumentBlobsRepo, type DocumentBlobRow } from '../db/repositories/document-blobs-repo';
import { hashFile } from '../portability/zip-archive';
import { AppError } from '../services/app-error';
import type { Clock } from '../services/clock';
import type { IdGenerator } from '../services/ids';
import type { Logger } from '../services/logger';
import { ATTACHMENT_GC_GRACE_MS, STALE_TMP_MAX_AGE_MS } from '../services/retention-policy';
import { containedDataFile, copyNewFileDurably, moveIntoPlace, sweepStaleFiles, writeNewFileDurably } from '../services/stored-files';
import { isDocumentOfKind } from './document-check';

export interface DocumentStoreDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  /** `<userData>/data`; blobs live under `documents/` inside it. */
  dataDir: string;
}

/**
 * The managed copies of documents (D-118): content-addressed blobs under `documents/<aa>/<id>.<ext>`. Bytes are checked
 * to be a document of their kind before they are kept, written once per SHA-256 (temp file, fsync, atomic rename) and
 * registered unreferenced until a document or version uses them; unused blobs go after the attachment grace period.
 */
export class DocumentStore {
  private readonly blobs: DocumentBlobsRepo;
  private readonly tmpDir: string;

  constructor(private readonly deps: DocumentStoreDeps) {
    this.blobs = new DocumentBlobsRepo(deps.db);
    this.tmpDir = path.join(deps.dataDir, 'documents', 'tmp');
  }

  private tempFile(): string {
    return path.join(this.tmpDir, `${randomUUID()}.part`);
  }

  async putBytes(kind: DocumentKind, bytes: Uint8Array): Promise<DocumentBlobRow> {
    const temp = this.tempFile();
    await writeNewFileDurably(temp, bytes);
    return this.commit(kind, temp);
  }

  /** Copies a file main chose (a picked file, an attachment, a linked original) into the store. */
  async putFile(kind: DocumentKind, file: string): Promise<DocumentBlobRow> {
    const temp = this.tempFile();
    await copyNewFileDurably(file, temp);
    return this.commit(kind, temp);
  }

  /** The real path of a stored blob, or null when it is gone or breaks containment. */
  fileOf(blob: Pick<DocumentBlobRow, 'relative_path'>): Promise<string | null> {
    return containedDataFile(this.deps.dataDir, 'documents', blob.relative_path).catch(() => null);
  }

  async read(blobId: string): Promise<Buffer> {
    const blob = this.blobs.get(blobId);
    const file = blob ? await this.fileOf(blob) : null;
    if (!file) throw new AppError('NOT_FOUND', DOCUMENT_MESSAGES.versionMissing);
    return fs.promises.readFile(file);
  }

  private async commit(kind: DocumentKind, temp: string): Promise<DocumentBlobRow> {
    try {
      if (!(await isDocumentOfKind(kind, temp))) throw new AppError('VALIDATION_FAILED', DOCUMENT_MESSAGES.damaged(kind));
      const { sha256, size } = await hashFile(temp);
      const existing = this.blobs.findBySha(sha256);
      if (existing) {
        // A stored row whose file went missing gets the file back.
        if (!(await this.fileOf(existing))) await moveIntoPlace(temp, path.join(this.deps.dataDir, existing.relative_path));
        return existing;
      }
      const id = this.deps.ids.uuid();
      const relativePath = `documents/${id.slice(0, 2)}/${id}.${DOCUMENT_KIND_INFO[kind].extension}`;
      const final = path.join(this.deps.dataDir, relativePath);
      await moveIntoPlace(temp, final);
      try {
        this.deps.db.transaction(() => this.blobs.insert({ id, sha256, relativePath, sizeBytes: size, now: this.deps.clock.now() }), 'immediate');
      } catch (err) {
        await fs.promises.rm(final, { force: true });
        // Another write of the same bytes won the race: use its row.
        const winner = this.blobs.findBySha(sha256);
        if (winner) return winner;
        throw err;
      }
      return this.blobs.get(id)!;
    } finally {
      await fs.promises.rm(temp, { force: true });
    }
  }

  /**
   * Deletes blobs that no document (live or trashed) and no version has used for the whole grace period (INF-PORT-08).
   * The rows go in one transaction that re-checks the references; the files are removed after it commits.
   */
  async collect(now: number): Promise<number> {
    const expired = this.deps.db.transaction(() => {
      this.blobs.reconcileReferences(now);
      const rows = this.blobs.unreferencedSince(now - ATTACHMENT_GC_GRACE_MS);
      this.blobs.deleteRows(rows.map((r) => r.id));
      return rows;
    }, 'immediate');
    for (const row of expired) {
      const file = await this.fileOf(row);
      if (file) await fs.promises.rm(file, { force: true });
    }
    return expired.length;
  }

  /** Removes leftovers of interrupted writes (older than one hour) at startup. */
  sweepTmp(now: number): Promise<number> {
    return sweepStaleFiles(this.tmpDir, now, STALE_TMP_MAX_AGE_MS, this.deps.logger, 'documents');
  }
}
