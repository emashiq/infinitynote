import type { Db } from '../driver';
import type { DocumentKind } from '../../../shared/documents/kinds';
import type { ReminderRow } from './reminders-repo';

export interface PortableNoteRow {
  id: string;
  project_id: string | null;
  folder_id: string | null;
  title: string;
  format: 'rich' | 'plain';
  content_json: string | null;
  content_text: string | null;
  sticky_enabled: number;
  color: string | null;
  text_color: string | null;
  pinned_at: number | null;
  favorite: number;
}

export interface PortableAttachmentRow {
  id: string;
  managed_relative_path: string;
  sha256: string;
  size_bytes: number;
  kind: 'image' | 'document';
  original_name: string | null;
}

export interface PortableDocumentRow {
  id: string;
  project_id: string | null;
  folder_id: string | null;
  title: string;
  kind: DocumentKind;
  favorite: number;
  linked_file_id: string | null;
  /** Managed documents: the stored blob. */
  relative_path: string | null;
  sha256: string | null;
  blob_size: number | null;
}

/** Reads for the portable export: live items only, and no locked note or anything only a locked note uses (D-111). */
export class PortableRepo {
  constructor(private readonly db: Db) {}

  liveNotes(): PortableNoteRow[] {
    return this.db
      .prepare<[], PortableNoteRow>(
        'SELECT id, project_id, folder_id, title, format, content_json, content_text, sticky_enabled, color, text_color, pinned_at, favorite FROM notes WHERE deleted_at IS NULL AND locked = 0 ORDER BY doc_key',
      )
      .all();
  }

  /** Tag names per live note. */
  tagsByNote(): Map<string, string[]> {
    const rows = this.db
      .prepare<[], { note_id: string; name: string }>(
        'SELECT nt.note_id, t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL ORDER BY t.name',
      )
      .all();
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.note_id, [...(map.get(r.note_id) ?? []), r.name]);
    return map;
  }

  /**
   * Live reminders of live notes that still have something to remind: recurring series, and one-time reminders with an
   * open occurrence. Completed one-time reminders and the occurrence history stay behind.
   */
  activeReminders(): ReminderRow[] {
    return this.db
      .prepare<[], ReminderRow>(
        `SELECT r.* FROM reminders r JOIN notes n ON n.id = r.note_id AND n.deleted_at IS NULL AND n.locked = 0
         WHERE r.deleted_at IS NULL
           AND (r.recurrence IS NOT NULL OR EXISTS (SELECT 1 FROM occurrences o WHERE o.reminder_id = r.id AND o.state IN ('pending', 'snoozed')))
         ORDER BY r.created_at, r.id`,
      )
      .all();
  }

  /** Live locked notes, which the export leaves out. */
  countLockedNotes(): number {
    return this.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM notes WHERE deleted_at IS NULL AND locked = 1').get()!.n;
  }

  /** Live documents with the blob of each managed one (D-118). */
  liveDocuments(): PortableDocumentRow[] {
    return this.db
      .prepare<[], PortableDocumentRow>(
        `SELECT d.id, d.project_id, d.folder_id, d.title, d.kind, d.favorite, d.linked_file_id, b.relative_path, b.sha256, b.size_bytes AS blob_size
           FROM documents d LEFT JOIN document_blobs b ON b.id = d.blob_id
          WHERE d.deleted_at IS NULL ORDER BY d.doc_key`,
      )
      .all();
  }

  /** Attachments linked from exported notes. */
  liveAttachments(): PortableAttachmentRow[] {
    return this.db
      .prepare<[], PortableAttachmentRow>(
        `SELECT a.id, a.managed_relative_path, a.sha256, a.size_bytes, a.kind, a.original_name FROM attachments a
         WHERE EXISTS (SELECT 1 FROM note_attachments na JOIN notes n ON n.id = na.note_id AND n.deleted_at IS NULL AND n.locked = 0 WHERE na.attachment_id = a.id)
         ORDER BY a.id`,
      )
      .all();
  }
}
