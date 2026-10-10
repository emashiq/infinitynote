import fs from 'node:fs';
import type { DocumentKind } from '../../shared/documents/kinds';
import type { Db } from '../db/driver';
import { DocumentBlobsRepo } from '../db/repositories/document-blobs-repo';
import { DocumentVersionsRepo } from '../db/repositories/document-versions-repo';
import { DocumentsRepo, type DocumentRow } from '../db/repositories/documents-repo';
import { LinkedFilesRepo } from '../db/repositories/linked-files-repo';
import { isUsableLinkPath } from '../services/linked-file';
import { containedDataFile } from '../services/stored-files';

/** Where a document's bytes are right now. */
export interface ResolvedDocumentFile {
  kind: DocumentKind;
  /** The real path: the stored blob, or the linked original with symbolic links followed. */
  file: string;
  sizeBytes: number;
  modifiedAt: number;
}

/** The modification time main compares, in whole milliseconds. */
export const modifiedAtOf = (stat: fs.Stats): number => Math.floor(stat.mtimeMs);

/**
 * Finds the file behind a live document (D-118). Callers name only a document ID; the path always comes from the
 * stored row. A managed blob must stay inside `documents/` (no symbolic links out of it); a linked original must be a
 * usable local path of an existing regular file, checked again each time (D-108, D-115).
 */
export class DocumentFiles {
  private readonly documents: DocumentsRepo;
  private readonly blobs: DocumentBlobsRepo;
  private readonly links: LinkedFilesRepo;
  private readonly versions: DocumentVersionsRepo;

  constructor(
    db: Db,
    private readonly dataDir: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.documents = new DocumentsRepo(db);
    this.blobs = new DocumentBlobsRepo(db);
    this.links = new LinkedFilesRepo(db);
    this.versions = new DocumentVersionsRepo(db);
  }

  /** The stored path of a linked document's original (shown to the user), or null. */
  linkedPath(row: DocumentRow): string | null {
    return row.linked_file_id === null ? null : (this.links.get(row.linked_file_id)?.path ?? null);
  }

  /** The file of a live document, or null when the document, its blob or its original is not there. */
  async resolveLive(documentId: string): Promise<ResolvedDocumentFile | null> {
    const row = this.documents.get(documentId);
    return row && row.deleted_at === null ? this.resolve(row) : null;
  }

  /** The stored bytes of one version of a live document, or null when the document or the version is not there. */
  async resolveVersion(documentId: string, versionId: string): Promise<ResolvedDocumentFile | null> {
    const row = this.documents.get(documentId);
    const version = row && row.deleted_at === null ? this.versions.get(documentId, versionId) : undefined;
    return row && version ? this.resolveBlob(row.kind, version.blob_id) : null;
  }

  async resolve(row: DocumentRow): Promise<ResolvedDocumentFile | null> {
    if (row.blob_id !== null) return this.resolveBlob(row.kind, row.blob_id);
    const original = this.linkedPath(row);
    return original === null ? null : this.resolveOriginal(row.kind, original);
  }

  /** A linked original at a stored path: a usable local path (checked before any file system call) of a regular file. */
  async resolveOriginal(kind: DocumentKind, original: string): Promise<ResolvedDocumentFile | null> {
    if (!isUsableLinkPath(original, this.platform)) return null;
    return this.resolveFile(kind, original);
  }

  /** Any file main chose (a picked file, a stored attachment): its real path when it is a regular file. */
  async resolveFile(kind: DocumentKind, file: string): Promise<ResolvedDocumentFile | null> {
    const real = await fs.promises.realpath(file).catch(() => null);
    return real ? this.stated(kind, real) : null;
  }

  private async resolveBlob(kind: DocumentKind, blobId: string): Promise<ResolvedDocumentFile | null> {
    const blob = this.blobs.get(blobId);
    const file = blob ? await containedDataFile(this.dataDir, 'documents', blob.relative_path).catch(() => null) : null;
    return file ? this.stated(kind, file) : null;
  }

  private async stated(kind: DocumentKind, file: string): Promise<ResolvedDocumentFile | null> {
    const stat = await fs.promises.stat(file).catch(() => null);
    return stat?.isFile() ? { kind, file, sizeBytes: stat.size, modifiedAt: modifiedAtOf(stat) } : null;
  }
}
