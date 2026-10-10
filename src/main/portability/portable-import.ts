import { createHash } from 'node:crypto';
import type { TreeChangedEventType } from '../../shared/contracts/hierarchy';
import { PORTABILITY_MESSAGES, type PortableCountsType } from '../../shared/contracts/portability';
import type { ReminderInputType } from '../../shared/contracts/reminders';
import type { RichDocLike } from '../../shared/editor/doc-schema';
import type { CommentAnchorType } from '../../shared/comments/anchors';
import type { Db } from '../db/driver';
import { CommentsRepo } from '../db/repositories/comments-repo';
import { DocumentsRepo } from '../db/repositories/documents-repo';
import type { DocumentStore } from '../documents/document-store';
import type { DocumentText } from '../documents/text/document-text';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { LinkedFilesRepo } from '../db/repositories/linked-files-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import { TagsRepo } from '../db/repositories/tags-repo';
import { AppError, errorDetail } from '../services/app-error';
import type { AttachmentService } from '../services/attachment-service';
import { EMPTY_DOC_JSON } from '../services/hierarchy-service';
import { isUsableLinkPath } from '../services/linked-file';
import type { Logger } from '../services/logger';
import { normalizeContent, type NoteContent } from '../services/note-content';
import type { ReminderService } from '../services/reminder-service';
import { runTx } from '../services/transaction';
import {
  MAX_PORTABLE_ATTACHMENT_BYTES,
  MAX_PORTABLE_DATA_BYTES,
  MAX_PORTABLE_DOCUMENT_BYTES,
  PORTABLE_DATA_ENTRY,
  parsePortableDocument,
  type PortableDocumentType,
} from './portable-format';
import { archivedBlockIds, createIdRemap, remapRichDoc, type IdRemap } from './remap';
import { ArchiveRefused, DEFAULT_ARCHIVE_LIMITS, openArchive, refusalError, type ArchiveLimits, type OpenedArchive } from './zip-archive';

export interface PortableImportDeps {
  db: Db;
  uuid: () => string;
  now: () => number;
  logger: Logger;
  attachments: Pick<AttachmentService, 'importArchived'>;
  documents: Pick<DocumentStore, 'putBytes' | 'fileOf'>;
  text: DocumentText;
  content: NoteContent;
  reminders: Pick<ReminderService, 'insertImported' | 'announceImported'>;
  onTreeChanged(event: TreeChangedEventType): void;
  limits?: ArchiveLimits;
}

export interface PortableImportResult {
  counts: PortableCountsType;
  skippedReminders: number;
  folderName: string | null;
}

const invalid = (): AppError => new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.notArchive);

/** Every reference inside the document must point at an item of the same document, and IDs must be unique. */
function checkStructure(doc: PortableDocumentType): void {
  const documents = doc.documents ?? [];
  const ids = [...doc.projects, ...doc.folders, ...doc.notes, ...documents].map((x) => x.id);
  if (new Set(ids).size !== ids.length) throw invalid();
  const projects = new Set(doc.projects.map((p) => p.id));
  const folders = new Map(doc.folders.map((f) => [f.id, f]));
  const notes = new Set(doc.notes.map((n) => n.id));
  for (const f of doc.folders) {
    if (f.projectId !== null && !projects.has(f.projectId)) throw invalid();
    if (f.parentId !== null && folders.get(f.parentId)?.projectId !== f.projectId) throw invalid();
  }
  for (const item of [...doc.notes, ...documents]) {
    if (item.projectId !== null && !projects.has(item.projectId)) throw invalid();
    if (item.folderId !== null && folders.get(item.folderId)?.projectId !== item.projectId) throw invalid();
  }
  if (doc.reminders.some((r) => !notes.has(r.noteId))) throw invalid();
  if (new Set(doc.attachments.map((a) => a.id)).size !== doc.attachments.length) throw invalid();
  const links = doc.links ?? [];
  if (new Set(links.map((l) => l.id)).size !== links.length) throw invalid();
  const linkIds = new Set(links.map((l) => l.id));
  if (documents.some((d) => d.storage === 'linked' && !linkIds.has(d.linkId))) throw invalid();
  const threads = doc.comments ?? [];
  if (new Set(threads.map((t) => t.id)).size !== threads.length) throw invalid();
  const documentIds = new Set(documents.map((d) => d.id));
  if (threads.some((t) => !(t.target.kind === 'note' ? notes : documentIds).has(t.target.id))) throw invalid();
}

/** A managed document's stored blob and text, by its archived ID. */
type StoredDocuments = Map<string, { blobId: string; sizeBytes: number; bodyText: string }>;

/** Reads and stores every managed document; one that is not a document of its kind is left out (D-118). */
async function importDocuments(deps: PortableImportDeps, archive: OpenedArchive, doc: PortableDocumentType): Promise<StoredDocuments> {
  const stored: StoredDocuments = new Map();
  for (const d of doc.documents ?? []) {
    if (d.storage !== 'managed') continue;
    const bytes = await archive.read(d.path, MAX_PORTABLE_DOCUMENT_BYTES);
    if (bytes.length !== d.size || createHash('sha256').update(bytes).digest('hex') !== d.sha256) {
      throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.damaged);
    }
    try {
      const blob = await deps.documents.putBytes(d.kind, bytes);
      const file = await deps.documents.fileOf(blob);
      stored.set(d.id, { blobId: blob.id, sizeBytes: blob.size_bytes, bodyText: file ? await deps.text.of(d.kind, file) : '' });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      deps.logger.warn(`import: document skipped id=${d.id} ${err.code}`);
    }
  }
  return stored;
}

/** Folders parents first; a cycle (no progress) is refused. */
function parentsFirst(folders: PortableDocumentType['folders']): PortableDocumentType['folders'] {
  const placed = new Set<string>();
  const ordered: PortableDocumentType['folders'] = [];
  let pending = folders;
  while (pending.length > 0) {
    const ready = pending.filter((f) => f.parentId === null || placed.has(f.parentId));
    if (ready.length === 0) throw invalid();
    for (const f of ready) {
      placed.add(f.id);
      ordered.push(f);
    }
    pending = pending.filter((f) => !placed.has(f.id));
  }
  return ordered;
}

/** Reads and stores every attachment; a file that is not what it claims (bad hash, not an image) is left out. */
async function importAttachments(deps: PortableImportDeps, archive: OpenedArchive, doc: PortableDocumentType): Promise<Map<string, string>> {
  const stored = new Map<string, string>();
  for (const a of doc.attachments) {
    const bytes = await archive.read(a.path, MAX_PORTABLE_ATTACHMENT_BYTES);
    if (bytes.length !== a.size || createHash('sha256').update(bytes).digest('hex') !== a.sha256) {
      throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.damaged);
    }
    try {
      stored.set(a.id, (await deps.attachments.importArchived(a.kind, bytes, a.originalName)).id);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      deps.logger.warn(`import: attachment skipped id=${a.id} ${err.code}`);
    }
  }
  return stored;
}

function localStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Imports a portable export (INF-PORT-04): every item gets a new ID, references and reminders follow their notes and
 * blocks, and nothing existing is overwritten. Projects arrive as new projects; Common items arrive in a new Common
 * folder "Imported <date>". The database part is one transaction, so a refused document changes nothing (attachment
 * files stored before it are unreferenced and fall to GC after the grace period).
 */
export async function importPortable(deps: PortableImportDeps, file: string): Promise<PortableImportResult> {
  let doc: PortableDocumentType;
  let stored: Map<string, string>;
  let storedDocuments: StoredDocuments;
  let archive: OpenedArchive | null = null;
  try {
    archive = await openArchive(file, deps.limits ?? DEFAULT_ARCHIVE_LIMITS);
    if (!archive.names.has(PORTABLE_DATA_ENTRY)) throw invalid();
    doc = parsePortableDocument(await archive.read(PORTABLE_DATA_ENTRY, MAX_PORTABLE_DATA_BYTES));
    checkStructure(doc);
    const documentFiles = (doc.documents ?? []).flatMap((d) => (d.storage === 'managed' ? [d.path] : []));
    const expected = new Set([PORTABLE_DATA_ENTRY, ...doc.attachments.map((a) => a.path), ...documentFiles]);
    if (archive.names.size !== expected.size || [...archive.names].some((n) => !expected.has(n))) {
      throw new AppError('VALIDATION_FAILED', PORTABILITY_MESSAGES.unsafe);
    }
    stored = await importAttachments(deps, archive, doc);
    storedDocuments = await importDocuments(deps, archive, doc);
  } catch (err) {
    deps.logger.warn(`import: refused ${errorDetail(err)}`);
    if (err instanceof ArchiveRefused) throw refusalError(err);
    throw err;
  } finally {
    archive?.close();
  }

  const remap = createIdRemap({
    uuid: deps.uuid,
    blocksByNote: new Map(doc.notes.filter((n) => n.format === 'rich').map((n) => [n.id, archivedBlockIds(n.content)])),
    attachments: stored,
    links: new Map((doc.links ?? []).map((l) => [l.id, deps.uuid()])),
    threads: new Map((doc.comments ?? []).map((t) => [t.id, deps.uuid()])),
  });
  const now = deps.now();
  const refusedLinks = (doc.links ?? []).filter((l) => !isUsableLinkPath(l.path)).length;
  const result = runTx(deps.db, deps.logger, () => writeDocument(deps, doc, remap, storedDocuments, now));
  deps.onTreeChanged({ reason: 'create', trashedNoteIds: [], trashedDocumentIds: [] });
  if (result.counts.reminders > 0) deps.reminders.announceImported(result.noteIdsWithReminders);
  deps.logger.info(`import: portable ${JSON.stringify(result.counts)} skippedReminders=${result.skippedReminders} refusedLinks=${refusedLinks}`);
  return { counts: result.counts, skippedReminders: result.skippedReminders, folderName: result.folderName };
}

function writeDocument(deps: PortableImportDeps, doc: PortableDocumentType, remap: IdRemap, storedDocuments: StoredDocuments, now: number) {
  const hierarchy = new HierarchyRepo(deps.db);
  const notes = new NotesRepo(deps.db);
  const tags = new TagsRepo(deps.db);
  const hasCommonItems =
    doc.folders.some((f) => f.projectId === null && f.parentId === null) || [...doc.notes, ...(doc.documents ?? [])].some((n) => n.projectId === null && n.folderId === null);
  const folderName = hasCommonItems ? `Imported ${localStamp(now)}` : null;
  const commonFolder = folderName ? deps.uuid() : null;
  if (commonFolder && folderName) hierarchy.insertFolder(commonFolder, null, null, folderName, now);
  const project = (id: string | null) => (id === null ? null : remap.item(id));
  // Link records only: the files stay where they were, so on another computer the chips show the file as missing. A
  // path that a new link could not have (a network or device path, another system's path) is not stored at all, so
  // nothing ever touches it; its chips show the link as unavailable (D-115).
  const links = new LinkedFilesRepo(deps.db);
  const storedLinks = new Map<string, number>();
  for (const l of doc.links ?? []) {
    if (!isUsableLinkPath(l.path)) continue;
    links.insert({ id: remap.link(l.id)!, path: l.path, name: l.name, sizeBytes: l.sizeBytes, now });
    storedLinks.set(l.id, l.sizeBytes);
  }

  for (const p of doc.projects) {
    hierarchy.insertProject(remap.item(p.id), p.name, now);
    if (p.favorite) hierarchy.setFavorite('project', remap.item(p.id), true);
  }
  for (const f of parentsFirst(doc.folders)) {
    const parent = f.parentId !== null ? remap.item(f.parentId) : f.projectId === null ? commonFolder : null;
    hierarchy.insertFolder(remap.item(f.id), project(f.projectId), parent, f.name, now);
    if (f.favorite) hierarchy.setFavorite('folder', remap.item(f.id), true);
  }
  for (const n of doc.notes) {
    const id = remap.item(n.id);
    const folder = n.folderId !== null ? remap.item(n.folderId) : n.projectId === null ? commonFolder : null;
    notes.createNote({ id, title: n.title, format: n.format, contentJson: EMPTY_DOC_JSON, contentText: '', now, projectId: project(n.projectId), folderId: folder });
    let content;
    try {
      content = n.format === 'rich' ? remapRichDoc(normalizeContent('rich', n.content) as RichDocLike, n.id, remap) : normalizeContent('plain', n.content);
    } catch {
      throw invalid();
    }
    deps.content.write({ noteId: id, format: n.format, content, title: null, expectedRevision: 0, now });
    if (n.sticky) hierarchy.setSticky(id, true);
    if (n.sticky && n.color) hierarchy.setColor(id, n.color);
    if (n.sticky && n.textColor) hierarchy.setTextColor(id, n.textColor);
    if (n.pinned) hierarchy.setPinned(id, true, now);
    if (n.favorite) hierarchy.setFavorite('note', id, true);
    if (n.tags.length > 0) tags.replaceForNote(id, n.tags);
  }
  // Documents follow their folders like notes. A managed one whose bytes were refused and a linked one whose link was
  // not stored are left out: a document always has its bytes or its link.
  const documents = new DocumentsRepo(deps.db);
  let importedDocuments = 0;
  const importedDocumentIds = new Set<string>();
  for (const d of doc.documents ?? []) {
    const blob = d.storage === 'managed' ? storedDocuments.get(d.id) : undefined;
    const linkedSize = d.storage === 'linked' ? storedLinks.get(d.linkId) : undefined;
    if (!blob && linkedSize === undefined) continue;
    const id = remap.item(d.id);
    documents.insert({
      id,
      projectId: project(d.projectId),
      folderId: d.folderId !== null ? remap.item(d.folderId) : d.projectId === null ? commonFolder : null,
      title: d.title,
      kind: d.kind,
      blobId: blob?.blobId ?? null,
      linkedFileId: d.storage === 'linked' ? remap.link(d.linkId) : null,
      sourceAttachmentId: null,
      sizeBytes: blob?.sizeBytes ?? linkedSize ?? 0,
      sourceModifiedAt: null,
      bodyText: blob?.bodyText ?? '',
      now,
    });
    if (d.favorite) documents.setFavorite(id, true);
    importedDocuments += 1;
    importedDocumentIds.add(d.id);
  }
  writeThreads(deps, doc, remap, importedDocumentIds, now);
  hierarchy.assertInvariants();

  let reminders = 0;
  let skippedReminders = 0;
  const noteIdsWithReminders: string[] = [];
  for (const r of doc.reminders) {
    const noteId = remap.item(r.noteId);
    const input: ReminderInputType = { ...r, blockId: r.blockId === null ? null : remap.block(r.noteId, r.blockId), allowPast: true };
    try {
      deps.reminders.insertImported(noteId, input);
      reminders += 1;
      noteIdsWithReminders.push(noteId);
    } catch (err) {
      // An unknown zone or a full note is refused before anything is written for this reminder.
      if (!(err instanceof AppError)) throw err;
      skippedReminders += 1;
    }
  }
  const counts = {
    projects: doc.projects.length,
    folders: doc.folders.length,
    notes: doc.notes.length,
    reminders,
    attachments: new Set(doc.attachments.map((a) => remap.attachment(a.id)).filter(Boolean)).size,
    documents: importedDocuments,
  };
  return { counts, skippedReminders, folderName, noteIdsWithReminders };
}

/**
 * The archive's comment threads (D-165) under their new IDs, on their imported notes and documents (a document left out
 * takes its threads along). A note's thread follows the block it was made in; its marks were remapped with the content.
 */
function writeThreads(deps: Pick<PortableImportDeps, 'db' | 'uuid'>, doc: PortableDocumentType, remap: IdRemap, importedDocuments: ReadonlySet<string>, now: number): void {
  const repo = new CommentsRepo(deps.db);
  for (const t of doc.comments ?? []) {
    if (t.target.kind === 'document' && !importedDocuments.has(t.target.id)) continue;
    const id = remap.thread(t.id)!;
    const anchor: CommentAnchorType = t.anchor.type === 'text' ? { type: 'text', blockId: t.anchor.blockId === null ? null : remap.block(t.target.id, t.anchor.blockId) } : t.anchor;
    repo.insertThread({ id, kind: t.target.kind, targetId: remap.item(t.target.id), anchorJson: JSON.stringify(anchor), quote: { text: t.quote, sealed: null }, resolvedAt: t.resolvedAt, now });
    for (const c of t.comments) repo.insertComment({ id: deps.uuid(), threadId: id, body: { text: c.body, sealed: null }, createdAt: c.createdAt, updatedAt: c.updatedAt });
  }
}
