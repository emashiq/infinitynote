import path from 'node:path';
import { ARCHIVE_FORMAT_VERSION, EXPORT_FORMAT, type PortableCountsType } from '../../shared/contracts/portability';
import { HexColor, NoteColor } from '../../shared/contracts/hierarchy';
import { CommentAnchor } from '../../shared/comments/anchors';
import type { Db } from '../db/driver';
import { CommentsRepo } from '../db/repositories/comments-repo';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { LinkedFilesRepo } from '../db/repositories/linked-files-repo';
import { PortableRepo } from '../db/repositories/portable-repo';
import { storedContent } from '../db/repositories/notes-repo';
import { DOCUMENT_KIND_INFO } from '../../shared/documents/kinds';
import { containedAttachmentFile } from '../services/attachment-files';
import { containedDataFile } from '../services/stored-files';
import type { Logger } from '../services/logger';
import { followupOf, recurrenceOf } from '../services/reminder-model';
import { PORTABLE_DATA_ENTRY, type PortableDocumentItem, type PortableDocumentType, type PortableThread } from './portable-format';
import { writeArchive, type ArchiveItem } from './zip-archive';

export interface PortableExportDeps {
  db: Db;
  dataDir: string;
  appVersion: string;
  now: () => number;
  logger: Logger;
}

/** The archive name of a managed document's bytes: the document's ID (two documents may share a blob). */
const archivedDocumentPath = (documentId: string, kind: PortableDocumentItem['kind']): string => `documents/${documentId}.${DOCUMENT_KIND_INFO[kind].extension}`;

/** The archive name of an attachment: its ID and stored extension, without the two-letter bucket. */
const archivedPath = (managedPath: string): string => `attachments/${path.posix.basename(managedPath)}`;

/**
 * Writes the portable export (INF-PORT-04): live projects, folders and notes with their content, tags, reminders and
 * attachment files, live documents (the bytes of managed ones), the records of linked files (not the files) and the
 * comment threads of all of these (D-165). Locked notes and their comments are left out (an export would hold their text
 * in the clear; D-111) and counted. Reads run in one transaction so the document is consistent.
 */
export async function writePortableExport(deps: PortableExportDeps, destFile: string): Promise<{ counts: PortableCountsType; skippedLocked: number }> {
  const hierarchy = new HierarchyRepo(deps.db);
  const repo = new PortableRepo(deps.db);
  const { doc, attachmentRows, documentRows, skippedLocked } = deps.db.transaction(() => {
    const tags = repo.tagsByNote();
    const attachmentRows = repo.liveAttachments();
    const documentRows = repo.liveDocuments();
    const doc: PortableDocumentType = {
      format: EXPORT_FORMAT,
      formatVersion: ARCHIVE_FORMAT_VERSION,
      appVersion: deps.appVersion,
      createdAt: deps.now(),
      projects: hierarchy.liveProjects().map((p) => ({ id: p.id, name: p.name, favorite: p.favorite === 1 })),
      folders: hierarchy.liveFolders().map((f) => ({ id: f.id, projectId: f.project_id, parentId: f.parent_id, name: f.name, favorite: f.favorite === 1 })),
      notes: repo.liveNotes().map((n) => {
        const color = NoteColor.safeParse(n.color);
        const textColor = HexColor.safeParse(n.text_color);
        return {
          id: n.id,
          projectId: n.project_id,
          folderId: n.folder_id,
          title: n.title,
          format: n.format,
          content: storedContent(n),
          sticky: n.sticky_enabled === 1,
          color: color.success ? color.data : null,
          textColor: textColor.success ? textColor.data : null,
          pinned: n.pinned_at !== null,
          favorite: n.favorite === 1,
          tags: tags.get(n.id) ?? [],
        };
      }),
      reminders: repo.activeReminders().map((r) => ({
        noteId: r.note_id,
        blockId: r.block_id,
        title: r.title,
        zoneId: r.zone_id,
        date: r.start_local_date,
        time: r.local_time,
        recurrence: recurrenceOf(r),
        foldPreference: r.fold_preference,
        followup: followupOf(r),
      })),
      attachments: attachmentRows.map((a) => ({
        id: a.id,
        path: archivedPath(a.managed_relative_path),
        sha256: a.sha256,
        size: a.size_bytes,
        kind: a.kind,
        originalName: a.original_name,
      })),
      links: new LinkedFilesRepo(deps.db).usedByExportableItems().map((l) => ({ id: l.id, path: l.path, name: l.name, sizeBytes: l.size_bytes })),
      documents: documentRows.map((d): PortableDocumentItem => {
        const base = { id: d.id, projectId: d.project_id, folderId: d.folder_id, title: d.title, kind: d.kind, favorite: d.favorite === 1 };
        return d.linked_file_id !== null
          ? { ...base, storage: 'linked', linkId: d.linked_file_id }
          : { ...base, storage: 'managed', path: archivedDocumentPath(d.id, d.kind), sha256: d.sha256!, size: d.blob_size! };
      }),
      comments: exportableThreads(deps.db),
    };
    return { doc, attachmentRows, documentRows, skippedLocked: repo.countLockedNotes() };
  });

  const files: ArchiveItem[] = [];
  const exported = new Set<string>();
  for (const row of attachmentRows) {
    const file = await containedAttachmentFile(deps.dataDir, row.managed_relative_path).catch(() => null);
    if (!file) {
      deps.logger.warn(`export: attachment file missing id=${row.id}`);
      continue;
    }
    exported.add(row.id);
    files.push({ name: archivedPath(row.managed_relative_path), file, compress: false });
  }
  // A missing file is left out of the document too; import then drops the nodes that used it.
  doc.attachments = doc.attachments.filter((a) => exported.has(a.id));
  const missingDocuments = new Set<string>();
  for (const row of documentRows) {
    if (row.relative_path === null) continue;
    const file = await containedDataFile(deps.dataDir, 'documents', row.relative_path).catch(() => null);
    if (!file) {
      deps.logger.warn(`export: document file missing id=${row.id}`);
      missingDocuments.add(row.id);
      continue;
    }
    files.push({ name: archivedDocumentPath(row.id, row.kind), file, compress: false });
  }
  doc.documents = doc.documents?.filter((d) => !missingDocuments.has(d.id));
  doc.comments = doc.comments?.filter((t) => t.target.kind === 'note' || !missingDocuments.has(t.target.id));
  await writeArchive(destFile, [{ name: PORTABLE_DATA_ENTRY, buffer: Buffer.from(JSON.stringify(doc)), compress: true }, ...files]);
  const counts = {
    projects: doc.projects.length,
    folders: doc.folders.length,
    notes: doc.notes.length,
    reminders: doc.reminders.length,
    attachments: doc.attachments.length,
    documents: doc.documents?.length ?? 0,
  };
  deps.logger.info(`export: portable ${JSON.stringify(counts)} skippedLocked=${skippedLocked}`);
  return { counts, skippedLocked };
}

/** The threads of exportable items with their comments, oldest first (D-165); every one of them is in the clear. */
function exportableThreads(db: Db): PortableThread[] {
  const repo = new CommentsRepo(db);
  const threads = repo.exportableThreads();
  const comments = new Map<string, PortableThread['comments']>();
  for (const c of repo.commentsOf(threads.map((t) => t.id))) {
    if (c.body === null) continue;
    const list = comments.get(c.thread_id) ?? [];
    list.push({ body: c.body, createdAt: c.created_at, updatedAt: c.updated_at });
    comments.set(c.thread_id, list);
  }
  return threads.flatMap((t) => {
    const anchor = CommentAnchor.safeParse(JSON.parse(t.anchor_json));
    const list = comments.get(t.id);
    if (!anchor.success || !list || t.quote === null) return [];
    return [{ id: t.id, target: { kind: t.target_kind, id: t.target_id }, anchor: anchor.data, quote: t.quote, resolvedAt: t.resolved_at, createdAt: t.created_at, comments: list }];
  });
}
