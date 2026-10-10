import fs from 'node:fs';
import path from 'node:path';
import { fileTooLarge, maxBytes } from '../../shared/attachments/limits';
import { extensionFor, isOpenableExtension, sanitizeOriginalName } from '../../shared/attachments/names';
import { HANDOFF_MESSAGES, LINK_MESSAGES, type FileLinkDtoType } from '../../shared/contracts/attachments';
import type { DocumentOpenResponseType, DocumentPickPdfResponseType, DocumentVersionDtoType, ExpectedFileType } from '../../shared/contracts/documents';
import type { DocumentDtoType, LocationType, TreeChangedEventType } from '../../shared/contracts/hierarchy';
import { DOCUMENT_KIND_INFO, documentKindOf, titleFromFileName, type BlankDocumentKind, type DocumentKind } from '../../shared/documents/kinds';
import { LINKED_DOCUMENT_SAVE_MAX_MB, MANAGED_DOCUMENT_MAX_MB } from '../../shared/documents/limits';
import { DOCUMENT_MESSAGES } from '../../shared/documents/messages';
import { suggestedFileName } from '../../shared/names';
import { selectAutoVersionsToPrune, type AutoVersionPolicy } from '../../shared/versions/retention';
import type { Db } from '../db/driver';
import { AttachmentsRepo } from '../db/repositories/attachments-repo';
import { DocumentBlobsRepo, type DocumentBlobRow } from '../db/repositories/document-blobs-repo';
import { DocumentVersionsRepo, type DocumentVersionReason } from '../db/repositories/document-versions-repo';
import { DocumentsRepo, type DocumentRow } from '../db/repositories/documents-repo';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { LinkedFilesRepo } from '../db/repositories/linked-files-repo';
import { AppError, errorDetail } from '../services/app-error';
import { containedAttachmentFile } from '../services/attachment-files';
import type { Clock } from '../services/clock';
import type { DialogAdapter } from '../services/dialog-adapter';
import { toDocumentDto } from '../services/dto';
import type { FilePicker } from '../services/file-picker';
import { assertLiveLocation, requireLive } from '../services/hierarchy-service';
import type { IdGenerator } from '../services/ids';
import { KeyedQueue } from '../services/keyed-queue';
import { inspectLinkedFile, isNetworkPath, isUsableLinkPath } from '../services/linked-file';
import type { LinkedFileService } from '../services/linked-file-service';
import type { Logger } from '../services/logger';
import { withExtension } from '../services/save-paths';
import type { SettingsService } from '../services/settings-service';
import type { ShellAdapter } from '../services/shell-adapter';
import { runTx } from '../services/transaction';
import { blankDocument } from './blank-documents';
import { isDocumentOfKind } from './document-check';
import { modifiedAtOf, type DocumentFiles, type ResolvedDocumentFile } from './document-files';
import type { DocumentStore } from './document-store';
import { copyDocumentFile, writeDocumentFile } from './file-writes';
import type { DocumentText } from './text/document-text';

export interface DocumentServiceDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  /** `<userData>/data`; note attachments are read from it for "Open in Infinity Notes". */
  dataDir: string;
  settings: Pick<SettingsService, 'getInternal'>;
  store: DocumentStore;
  files: DocumentFiles;
  /** Reads the searchable text of saved and imported files. */
  text: DocumentText;
  links: Pick<LinkedFileService, 'create'>;
  picker: Pick<FilePicker, 'pickDocuments' | 'claim'>;
  dialog: Pick<DialogAdapter, 'showSaveFile' | 'showOpenFile'>;
  shell: ShellAdapter;
  /** The version retention of notes applies to documents too (age and count settings). */
  versionPolicy: () => AutoVersionPolicy;
  onChange: (event: TreeChangedEventType) => void;
  platform?: NodeJS.Platform;
}

interface NewDocument {
  location: LocationType;
  title: string;
  kind: DocumentKind;
  sourceAttachmentId?: string;
}

/** The bytes a save put in place, and the blob of the bytes it replaced (kept as a version) if any. */
interface WrittenContent {
  blobId: string | null;
  sizeBytes: number;
  sourceModifiedAt: number | null;
  bodyText: string;
  previousBlobId: string | null;
}

const MANAGED_MAX_BYTES = maxBytes(MANAGED_DOCUMENT_MAX_MB);
const LINKED_SAVE_MAX_BYTES = maxBytes(LINKED_DOCUMENT_SAVE_MAX_MB);
const MAX_TITLE_CHARS = 200;
const COPY_SUFFIX = ' (copy)';
const PDF_FILTER = { name: 'PDF documents', extensions: ['pdf'] };

/**
 * Documents as tree items (D-118): creating blank Office files, importing files by copy or link (the v0.2.0 rules of
 * D-108: the copy limit, links only to local files), "Open in Infinity Notes" for a note's attachments and linked
 * files, opening, saving with a revision check, versions, saving a copy, and handing a document to the OS. Saves of
 * one document run one at a time. Renaming, moving and favorites are hierarchy operations; trash is TrashService's.
 */
export class DocumentService {
  private readonly documents: DocumentsRepo;
  private readonly versions: DocumentVersionsRepo;
  private readonly blobs: DocumentBlobsRepo;
  private readonly hierarchy: HierarchyRepo;
  private readonly attachments: AttachmentsRepo;
  private readonly linkedFiles: LinkedFilesRepo;
  private readonly saves = new KeyedQueue();
  private readonly platform: NodeJS.Platform;

  constructor(private readonly deps: DocumentServiceDeps) {
    this.documents = new DocumentsRepo(deps.db);
    this.versions = new DocumentVersionsRepo(deps.db);
    this.blobs = new DocumentBlobsRepo(deps.db);
    this.hierarchy = new HierarchyRepo(deps.db);
    this.attachments = new AttachmentsRepo(deps.db);
    this.linkedFiles = new LinkedFilesRepo(deps.db);
    this.platform = deps.platform ?? process.platform;
  }

  // Creating and importing ----------------------------------------------------------
  async createBlank(kind: BlankDocumentKind, location: LocationType, title?: string): Promise<{ document: DocumentDtoType }> {
    const blob = await this.storing(DOCUMENT_MESSAGES.importFailed, async () => this.deps.store.putBytes(kind, await blankDocument(kind)));
    return { document: this.insertManaged({ location, kind, title: title ?? DOCUMENT_KIND_INFO[kind].blankTitle }, blob, '') };
  }

  /**
   * A new managed document of the same kind in the same place as an existing one (F2 "Extract pages", D-131). The bytes
   * are checked to be that kind (DocumentStore) and must fit the store.
   */
  async createBeside(documentId: string, title: string, bytes: Uint8Array): Promise<{ document: DocumentDtoType }> {
    const source = this.liveRow(documentId);
    if (bytes.byteLength > MANAGED_MAX_BYTES) throw new AppError('LIMIT_EXCEEDED', DOCUMENT_MESSAGES.tooLargeToStore(MANAGED_DOCUMENT_MAX_MB));
    const blob = await this.storing(DOCUMENT_MESSAGES.importFailed, () => this.deps.store.putBytes(source.kind, bytes));
    const location = { projectId: source.project_id, folderId: source.folder_id };
    return { document: this.insertManaged({ location, kind: source.kind, title }, blob, await this.blobText(source.kind, blob)) };
  }

  /**
   * "Insert pages from a PDF" (D-131): one file picked in main's dialog. Its bytes go to the viewer only after main saw
   * a regular file within the store limit (the merged document must fit it too) with a PDF header.
   */
  async pickPdf(ctx: { webContentsId: number }): Promise<DocumentPickPdfResponseType> {
    const picked = await this.deps.dialog.showOpenFile({ webContentsId: ctx.webContentsId, title: 'Insert pages from a PDF', filters: [PDF_FILTER] });
    if (picked === null) return { canceled: true };
    const resolved = await this.deps.files.resolveFile('pdf', picked);
    if (!resolved) throw new AppError('NOT_FOUND', DOCUMENT_MESSAGES.importFailed);
    if (resolved.sizeBytes > MANAGED_MAX_BYTES) throw new AppError('LIMIT_EXCEEDED', DOCUMENT_MESSAGES.tooLargeToInsert(MANAGED_DOCUMENT_MAX_MB));
    if (!(await isDocumentOfKind('pdf', resolved.file))) throw new AppError('VALIDATION_FAILED', DOCUMENT_MESSAGES.damaged('pdf'));
    const bytes = await this.storing(DOCUMENT_MESSAGES.importFailed, () => fs.promises.readFile(resolved.file));
    return { canceled: false, name: sanitizeOriginalName(picked) ?? 'document.pdf', bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
  }

  pickFiles(ctx: { webContentsId: number }) {
    return this.deps.picker.pickDocuments(ctx);
  }

  /** Copies or links one picked file as a document; a copy obeys the copy limit, a link any size (D-108). */
  async addPicked(
    req: { pickId: string; index: number; action: 'copy' | 'link'; location: LocationType },
    ctx: { webContentsId: number },
  ): Promise<{ document: DocumentDtoType }> {
    const { path: file } = this.deps.picker.claim(req, 'documents', ctx);
    const name = sanitizeOriginalName(file) ?? 'file';
    const kind = documentKindOf(name);
    if (!kind) throw new AppError('UNSUPPORTED', DOCUMENT_MESSAGES.unsupported);
    const wanted = { location: req.location, kind, title: titleFromFileName(name, kind) };
    if (req.action === 'link') return { document: await this.insertLinked(wanted, await this.deps.links.create(file)) };
    const limitMb = this.deps.settings.getInternal('attachments.documentMaxMb');
    return { document: await this.copyIn(wanted, file, maxBytes(limitMb), fileTooLarge(limitMb)) };
  }

  /**
   * "Open in Infinity Notes" for a file attached to a note: the first time a managed copy is made next to the note;
   * afterwards the same document opens again while it is not in Trash.
   */
  async fromAttachment(noteId: string, attachmentId: string): Promise<{ document: DocumentDtoType; created: boolean }> {
    const note = requireLive(this.hierarchy.getNoteMeta(noteId));
    const row = this.attachments.isLinked(noteId, attachmentId) ? this.attachments.get(attachmentId) : undefined;
    if (!row) throw new AppError('NOT_FOUND', HANDOFF_MESSAGES.missing);
    const existing = this.documents.liveFromAttachment(attachmentId);
    if (existing) return { document: toDocumentDto(existing), created: false };
    const name = row.original_name ?? path.posix.basename(row.managed_relative_path);
    const kind = documentKindOf(name);
    if (!kind) throw new AppError('UNSUPPORTED', DOCUMENT_MESSAGES.unsupported);
    const file = await containedAttachmentFile(this.deps.dataDir, row.managed_relative_path).catch(() => null);
    if (!file) throw new AppError('NOT_FOUND', HANDOFF_MESSAGES.missing);
    const wanted = { location: { projectId: note.project_id, folderId: note.folder_id }, kind, title: titleFromFileName(name, kind), sourceAttachmentId: attachmentId };
    return { document: await this.copyIn(wanted, file, MANAGED_MAX_BYTES, DOCUMENT_MESSAGES.tooLargeToStore(MANAGED_DOCUMENT_MAX_MB)), created: true };
  }

  /** "Open in Infinity Notes" for a file a note links to: a linked document of the same link (D-108), made once. */
  async fromLink(noteId: string, linkId: string): Promise<{ document: DocumentDtoType; created: boolean }> {
    const note = requireLive(this.hierarchy.getNoteMeta(noteId));
    const link = this.linkedFiles.isUsedBy(noteId, linkId) ? this.linkedFiles.get(linkId) : undefined;
    if (!link) throw new AppError('NOT_FOUND', LINK_MESSAGES.unavailable);
    const existing = this.documents.liveFromLink(linkId);
    if (existing) return { document: toDocumentDto(existing), created: false };
    const kind = documentKindOf(link.name);
    if (!kind) throw new AppError('UNSUPPORTED', DOCUMENT_MESSAGES.unsupported);
    const wanted = { location: { projectId: note.project_id, folderId: note.folder_id }, kind, title: titleFromFileName(link.name, kind) };
    return { document: await this.insertLinked(wanted, { id: link.id, path: link.path }), created: true };
  }

  private async copyIn(wanted: NewDocument, file: string, limitBytes: number, tooLarge: string): Promise<DocumentDtoType> {
    const resolved = await this.deps.files.resolveFile(wanted.kind, file);
    if (!resolved) throw new AppError('NOT_FOUND', DOCUMENT_MESSAGES.importFailed);
    // Checked before reading, so an oversized file is never copied.
    if (resolved.sizeBytes > limitBytes) throw new AppError('LIMIT_EXCEEDED', tooLarge);
    const blob = await this.storing(DOCUMENT_MESSAGES.importFailed, () => this.deps.store.putFile(wanted.kind, resolved.file));
    return this.insertManaged(wanted, blob, await this.blobText(wanted.kind, blob));
  }

  private async insertLinked(wanted: NewDocument, link: Pick<FileLinkDtoType, 'id' | 'path'>): Promise<DocumentDtoType> {
    const original = await this.deps.files.resolveOriginal(wanted.kind, link.path);
    if (!original) throw new AppError('NOT_FOUND', LINK_MESSAGES.notFound(link.path));
    if (!(await isDocumentOfKind(wanted.kind, original.file))) throw new AppError('VALIDATION_FAILED', DOCUMENT_MESSAGES.damaged(wanted.kind));
    const bodyText = await this.deps.text.of(wanted.kind, original.file);
    return this.insert(wanted, { blobId: null, linkedFileId: link.id, sizeBytes: original.sizeBytes, sourceModifiedAt: original.modifiedAt, bodyText });
  }

  private insertManaged(wanted: NewDocument, blob: DocumentBlobRow, bodyText: string): DocumentDtoType {
    return this.insert(wanted, { blobId: blob.id, linkedFileId: null, sizeBytes: blob.size_bytes, sourceModifiedAt: null, bodyText });
  }

  private insert(
    wanted: NewDocument,
    content: { blobId: string | null; linkedFileId: string | null; sizeBytes: number; sourceModifiedAt: number | null; bodyText: string },
  ): DocumentDtoType {
    const document = runTx(this.deps.db, this.deps.logger, () => {
      assertLiveLocation(this.hierarchy, wanted.location.projectId, wanted.location.folderId);
      const id = this.deps.ids.uuid();
      this.documents.insert({
        id,
        projectId: wanted.location.projectId,
        folderId: wanted.location.folderId,
        title: wanted.title,
        kind: wanted.kind,
        sourceAttachmentId: wanted.sourceAttachmentId ?? null,
        ...content,
        now: this.deps.clock.now(),
      });
      return toDocumentDto(this.documents.get(id)!);
    });
    this.deps.onChange({ reason: 'create', trashedNoteIds: [], trashedDocumentIds: [] });
    return document;
  }

  // Opening ---------------------------------------------------------------------
  /**
   * The document and, for a linked one, its original's state. An original changed outside the app since it was last
   * indexed has its size and text taken again (no new revision).
   */
  async open(documentId: string): Promise<DocumentOpenResponseType> {
    const row = this.liveRow(documentId);
    const original = this.deps.files.linkedPath(row);
    if (original === null) return { document: toDocumentDto(row), file: null };
    const current = await this.deps.files.resolve(row);
    if (!current) return { document: toDocumentDto(row), file: { path: original, state: 'missing', sizeBytes: null, modifiedAt: null } };
    const fileInfo = { path: original, sizeBytes: current.sizeBytes, modifiedAt: current.modifiedAt };
    if (!(await isDocumentOfKind(row.kind, current.file))) return { document: toDocumentDto(row), file: { ...fileInfo, state: 'damaged' } };
    if (current.sizeBytes !== row.size_bytes || current.modifiedAt !== row.source_modified_at) {
      const bodyText = await this.deps.text.of(row.kind, current.file);
      runTx(this.deps.db, this.deps.logger, () => this.documents.refreshLinked(row.id, current.sizeBytes, current.modifiedAt, bodyText));
    }
    return { document: toDocumentDto(this.documents.get(row.id)!), file: { ...fileInfo, state: 'available' } };
  }

  // Saving ----------------------------------------------------------------------
  /**
   * Saves new bytes as the next revision, after they were checked to be a document of the kind. A managed document gets
   * a new blob; a linked one is rewritten in place (temp file and rename in its folder) unless its original changed
   * since it was opened. The bytes replaced are kept as a version (for a linked file only within the store's size).
   */
  save(req: { documentId: string; baseRevision: number; bytes: Uint8Array; expectedFile?: ExpectedFileType }): Promise<DocumentOpenResponseType> {
    return this.saves.run(req.documentId, () => this.write(req.documentId, req.baseRevision, req.bytes, req.expectedFile, 'save'));
  }

  /** Puts an earlier version's bytes back as the next revision; the current bytes become a version. */
  restoreVersion(req: { documentId: string; versionId: string; baseRevision: number; expectedFile?: ExpectedFileType }): Promise<DocumentOpenResponseType> {
    return this.saves.run(req.documentId, async () => {
      const version = this.versions.get(req.documentId, req.versionId);
      if (!version) throw new AppError('NOT_FOUND', DOCUMENT_MESSAGES.versionMissing);
      const bytes = await this.deps.store.read(version.blob_id);
      return this.write(req.documentId, req.baseRevision, bytes, req.expectedFile, 'restore');
    });
  }

  /** A new managed document next to this one with an earlier version's bytes ("Save as copy" in Versions). */
  async copyVersion(documentId: string, versionId: string): Promise<{ document: DocumentDtoType }> {
    const row = this.liveRow(documentId);
    const version = this.versions.get(documentId, versionId);
    const blob = version ? this.blobs.get(version.blob_id) : undefined;
    if (!version || !blob) throw new AppError('NOT_FOUND', DOCUMENT_MESSAGES.versionMissing);
    const title = [...`${row.title} (revision ${version.revision})`].slice(0, MAX_TITLE_CHARS).join('');
    const location = { projectId: row.project_id, folderId: row.folder_id };
    return { document: this.insertManaged({ location, kind: row.kind, title }, blob, await this.blobText(row.kind, blob)) };
  }

  versionsOf(documentId: string): { versions: DocumentVersionDtoType[] } {
    this.liveRow(documentId);
    return {
      versions: this.versions.list(documentId).map((v) => ({ id: v.id, revision: v.revision, reason: v.reason, sizeBytes: v.size_bytes, createdAt: v.created_at })),
    };
  }

  private async write(
    documentId: string,
    baseRevision: number,
    bytes: Uint8Array,
    expectedFile: ExpectedFileType | undefined,
    reason: DocumentVersionReason,
  ): Promise<DocumentOpenResponseType> {
    const row = this.liveRow(documentId);
    if (row.revision !== baseRevision) throw revisionConflict(row.revision);
    if (row.storage === 'managed') {
      const content = await this.writeManaged(row, bytes);
      return { document: this.commit(row, content, reason), file: null };
    }
    const { content, file } = await this.writeLinked(row, bytes, expectedFile);
    return { document: this.commit(row, content, reason), file: { ...file, state: 'available' } };
  }

  private async writeManaged(row: DocumentRow, bytes: Uint8Array): Promise<WrittenContent> {
    if (bytes.byteLength > MANAGED_MAX_BYTES) throw new AppError('LIMIT_EXCEEDED', DOCUMENT_MESSAGES.tooLargeToStore(MANAGED_DOCUMENT_MAX_MB));
    const blob = await this.storing(DOCUMENT_MESSAGES.saveFailed, () => this.deps.store.putBytes(row.kind, bytes));
    const bodyText = await this.blobText(row.kind, blob);
    return { blobId: blob.id, sizeBytes: blob.size_bytes, sourceModifiedAt: null, bodyText, previousBlobId: row.blob_id };
  }

  private async writeLinked(
    row: DocumentRow,
    bytes: Uint8Array,
    expectedFile: ExpectedFileType | undefined,
  ): Promise<{ content: WrittenContent; file: { path: string; sizeBytes: number; modifiedAt: number } }> {
    if (bytes.byteLength > LINKED_SAVE_MAX_BYTES) throw new AppError('LIMIT_EXCEEDED', DOCUMENT_MESSAGES.tooLargeToSave(LINKED_DOCUMENT_SAVE_MAX_MB));
    if (!expectedFile) throw new AppError('VALIDATION_FAILED', 'Invalid request: expectedFile');
    const original = this.deps.files.linkedPath(row)!;
    const current = await this.deps.files.resolve(row);
    if (!current) throw new AppError('NOT_FOUND', LINK_MESSAGES.notFound(original));
    if (current.sizeBytes !== expectedFile.sizeBytes || current.modifiedAt !== expectedFile.modifiedAt) {
      throw new AppError('CONFLICT', DOCUMENT_MESSAGES.changedOnDisk, { reason: 'changedOnDisk', file: { sizeBytes: current.sizeBytes, modifiedAt: current.modifiedAt } });
    }
    const previous = await this.keepPrevious(current);
    const written = await this.storing(DOCUMENT_MESSAGES.saveFailed, () => writeDocumentFile(current.file, row.kind, bytes));
    const bodyText = await this.deps.text.of(row.kind, current.file);
    const file = { path: original, sizeBytes: written.size, modifiedAt: modifiedAtOf(written) };
    return { content: { blobId: null, sizeBytes: file.sizeBytes, sourceModifiedAt: file.modifiedAt, bodyText, previousBlobId: previous }, file };
  }

  /** The blob of a linked original's bytes before they are replaced, while they fit in the store; null otherwise. */
  private async keepPrevious(current: ResolvedDocumentFile): Promise<string | null> {
    if (current.sizeBytes > MANAGED_MAX_BYTES) return null;
    try {
      return (await this.deps.store.putFile(current.kind, current.file)).id;
    } catch (err) {
      this.deps.logger.warn(`documents: previous version not kept ${errorDetail(err)}`);
      return null;
    }
  }

  /** Records the new content as the next revision with the replaced bytes as a version, pruned to the retention. */
  private commit(row: DocumentRow, c: WrittenContent, reason: DocumentVersionReason): DocumentDtoType {
    return runTx(this.deps.db, this.deps.logger, () => {
      const now = this.deps.clock.now();
      if (!this.documents.writeContent({ id: row.id, blobId: c.blobId, sizeBytes: c.sizeBytes, sourceModifiedAt: c.sourceModifiedAt, bodyText: c.bodyText, expectedRevision: row.revision, now })) {
        throw revisionConflict(this.documents.get(row.id)?.revision ?? row.revision);
      }
      if (c.previousBlobId !== null && c.previousBlobId !== c.blobId) {
        this.versions.insert({ id: this.deps.ids.uuid(), documentId: row.id, revision: row.revision, blobId: c.previousBlobId, reason, now });
        this.pruneVersionsOf(row.id, now);
      }
      if (row.linked_file_id !== null) this.linkedFiles.setSize(row.linked_file_id, c.sizeBytes);
      return toDocumentDto(this.documents.get(row.id)!);
    });
  }

  private pruneVersionsOf(documentId: string, now: number): number {
    const rows = this.versions.list(documentId).map((v) => ({ id: v.id, createdAt: v.created_at }));
    const ids = selectAutoVersionsToPrune(rows, now, this.deps.versionPolicy());
    this.versions.deleteIds(ids);
    return ids.length;
  }

  /** Applies the version retention to every document (maintenance). */
  pruneVersions(now: number): number {
    return runTx(this.deps.db, this.deps.logger, () => this.versions.documentsWithVersions().reduce((n, id) => n + this.pruneVersionsOf(id, now), 0));
  }

  /**
   * Writes the given bytes to a file the user picks and adds it as a new linked document next to this one ("Save a
   * copy", also the way out of a conflict on a linked file). Network locations are refused before anything is written.
   */
  async saveCopy(req: { documentId: string; bytes: Uint8Array }, ctx: { webContentsId: number }): Promise<{ canceled: true } | { canceled: false; document: DocumentDtoType }> {
    const row = this.liveRow(req.documentId);
    if (req.bytes.byteLength > LINKED_SAVE_MAX_BYTES) throw new AppError('LIMIT_EXCEEDED', DOCUMENT_MESSAGES.tooLargeToSave(LINKED_DOCUMENT_SAVE_MAX_MB));
    const info = DOCUMENT_KIND_INFO[row.kind];
    const chosen = await this.deps.dialog.showSaveFile({
      webContentsId: ctx.webContentsId,
      title: 'Save a copy',
      defaultName: `${suggestedFileName(row.title)}${COPY_SUFFIX}.${info.extension}`,
      filters: [{ name: info.label, extensions: [info.extension] }],
    });
    if (chosen === null) return { canceled: true };
    const target = withExtension(chosen, info.extension);
    if (this.platform === 'win32' && isNetworkPath(target)) throw new AppError('VALIDATION_FAILED', LINK_MESSAGES.networkLocation);
    if (!isUsableLinkPath(target, this.platform)) throw new AppError('VALIDATION_FAILED', DOCUMENT_MESSAGES.copyFailed);
    await this.storing(DOCUMENT_MESSAGES.copyFailed, () => writeDocumentFile(target, row.kind, req.bytes));
    const title = [...`${row.title}${COPY_SUFFIX}`].slice(0, MAX_TITLE_CHARS).join('');
    const document = await this.insertLinked({ location: { projectId: row.project_id, folderId: row.folder_id }, kind: row.kind, title }, await this.deps.links.create(target));
    return { canceled: false, document };
  }

  /**
   * "Export a copy…": the saved bytes (or a version's) written to a file the user picks, without adding a document.
   * Network locations are refused before anything is written, as for Save a copy.
   */
  async exportCopy(req: { documentId: string; versionId?: string }, ctx: { webContentsId: number }): Promise<{ canceled: boolean }> {
    const row = this.liveRow(req.documentId);
    const source = await this.fileOf(req.documentId, req.versionId);
    const info = DOCUMENT_KIND_INFO[row.kind];
    const chosen = await this.deps.dialog.showSaveFile({
      webContentsId: ctx.webContentsId,
      title: 'Export a copy',
      defaultName: `${suggestedFileName(row.title)}.${info.extension}`,
      filters: [{ name: info.label, extensions: [info.extension] }],
    });
    if (chosen === null) return { canceled: true };
    const target = withExtension(chosen, info.extension);
    if (this.platform === 'win32' && isNetworkPath(target)) throw new AppError('VALIDATION_FAILED', LINK_MESSAGES.networkLocation);
    if (!isUsableLinkPath(target, this.platform)) throw new AppError('VALIDATION_FAILED', DOCUMENT_MESSAGES.copyFailed);
    const key = (file: string) => (this.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file));
    if (key(target) === key(source.file)) throw new AppError('VALIDATION_FAILED', DOCUMENT_MESSAGES.exportOverOriginal);
    await this.storing(DOCUMENT_MESSAGES.copyFailed, () => copyDocumentFile(source.file, target, row.kind));
    return { canceled: false };
  }

  /** Where the bytes of a live document (or one of its versions) are, for readers in main such as the spreadsheet editor. */
  async fileOf(documentId: string, versionId?: string): Promise<ResolvedDocumentFile> {
    const row = this.liveRow(documentId);
    if (versionId === undefined) return this.resolved(row);
    const file = await this.deps.files.resolveVersion(documentId, versionId);
    if (!file) throw new AppError('NOT_FOUND', DOCUMENT_MESSAGES.versionMissing);
    return file;
  }

  // The OS ----------------------------------------------------------------------
  /**
   * Opens a document in its system app: only the Office, PDF and CSV types (never an HTML page, which would run its
   * scripts in a browser), and for a linked file the checks of D-108 (its name and resolved name, no execute bit).
   */
  async openExternal(documentId: string): Promise<{ opened: true }> {
    const row = this.liveRow(documentId);
    const file = await this.resolved(row);
    const openable =
      row.storage === 'managed' ? isOpenableExtension(extensionFor(file.file)) : (await inspectLinkedFile(this.deps.files.linkedPath(row)!, this.platform)).state === 'available';
    if (!openable) throw new AppError('FORBIDDEN', DOCUMENT_MESSAGES.notOpenable);
    const error = await this.deps.shell.openPath(file.file);
    if (error) {
      this.deps.logger.warn(`documents: open failed id=${documentId}: ${error}`);
      throw new AppError('UNSUPPORTED', HANDOFF_MESSAGES.failed);
    }
    return { opened: true };
  }

  async showInFolder(documentId: string): Promise<{ shown: true }> {
    const row = this.liveRow(documentId);
    const file = await this.resolved(row);
    this.deps.shell.showItemInFolder(this.deps.files.linkedPath(row) ?? file.file);
    return { shown: true };
  }

  // Helpers ---------------------------------------------------------------------
  private liveRow(documentId: string): DocumentRow {
    const row = this.documents.get(documentId);
    if (!row) throw new AppError('NOT_FOUND', DOCUMENT_MESSAGES.missing);
    if (row.deleted_at !== null) throw new AppError('NOT_FOUND', DOCUMENT_MESSAGES.inTrash);
    return row;
  }

  private async resolved(row: DocumentRow): Promise<ResolvedDocumentFile> {
    const file = await this.deps.files.resolve(row);
    if (file) return file;
    const original = this.deps.files.linkedPath(row);
    throw new AppError('NOT_FOUND', original === null ? HANDOFF_MESSAGES.missing : LINK_MESSAGES.notFound(original));
  }

  private async blobText(kind: DocumentKind, blob: DocumentBlobRow): Promise<string> {
    const file = await this.deps.store.fileOf(blob);
    return file ? this.deps.text.of(kind, file) : '';
  }

  /** Runs a file step; anything but a user-facing refusal is logged and becomes `message`. */
  private async storing<T>(message: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.deps.logger.error(`documents: ${message} ${errorDetail(err)}`);
      throw new AppError('INTERNAL', message);
    }
  }
}

function revisionConflict(currentRevision: number): AppError {
  return new AppError('CONFLICT', DOCUMENT_MESSAGES.revisionChanged, { reason: 'revision', currentRevision });
}
