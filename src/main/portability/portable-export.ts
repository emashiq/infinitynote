import path from 'node:path';
import { ARCHIVE_FORMAT_VERSION, EXPORT_FORMAT, type PortableCountsType } from '../../shared/contracts/portability';
import { NoteColor } from '../../shared/contracts/hierarchy';
import type { Db } from '../db/driver';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { PortableRepo } from '../db/repositories/portable-repo';
import { storedContent } from '../db/repositories/notes-repo';
import { containedAttachmentFile } from '../services/attachment-files';
import type { Logger } from '../services/logger';
import { followupOf, recurrenceOf } from '../services/reminder-model';
import { PORTABLE_DATA_ENTRY, type PortableDocumentType } from './portable-format';
import { writeArchive, type ArchiveItem } from './zip-archive';

export interface PortableExportDeps {
  db: Db;
  dataDir: string;
  appVersion: string;
  now: () => number;
  logger: Logger;
}

/** The archive name of an attachment: its ID and stored extension, without the two-letter bucket. */
const archivedPath = (managedPath: string): string => `attachments/${path.posix.basename(managedPath)}`;

/**
 * Writes the portable export (INF-PORT-04): live projects, folders and notes with their content, tags, reminders and
 * attachment files. Reads run in one transaction so the document is consistent.
 */
export async function writePortableExport(deps: PortableExportDeps, destFile: string): Promise<PortableCountsType> {
  const hierarchy = new HierarchyRepo(deps.db);
  const repo = new PortableRepo(deps.db);
  const { doc, attachmentRows } = deps.db.transaction(() => {
    const tags = repo.tagsByNote();
    const attachmentRows = repo.liveAttachments();
    const doc: PortableDocumentType = {
      format: EXPORT_FORMAT,
      formatVersion: ARCHIVE_FORMAT_VERSION,
      appVersion: deps.appVersion,
      createdAt: deps.now(),
      projects: hierarchy.liveProjects().map((p) => ({ id: p.id, name: p.name, favorite: p.favorite === 1 })),
      folders: hierarchy.liveFolders().map((f) => ({ id: f.id, projectId: f.project_id, parentId: f.parent_id, name: f.name, favorite: f.favorite === 1 })),
      notes: repo.liveNotes().map((n) => {
        const color = NoteColor.safeParse(n.color);
        return {
          id: n.id,
          projectId: n.project_id,
          folderId: n.folder_id,
          title: n.title,
          format: n.format,
          content: storedContent(n),
          sticky: n.sticky_enabled === 1,
          color: color.success ? color.data : null,
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
    };
    return { doc, attachmentRows };
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
  await writeArchive(destFile, [{ name: PORTABLE_DATA_ENTRY, buffer: Buffer.from(JSON.stringify(doc)), compress: true }, ...files]);
  const counts = { projects: doc.projects.length, folders: doc.folders.length, notes: doc.notes.length, reminders: doc.reminders.length, attachments: files.length };
  deps.logger.info(`export: portable ${JSON.stringify(counts)}`);
  return counts;
}
