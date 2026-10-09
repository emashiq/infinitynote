import type { NoteContentResponseType, VersionsListResponseType, VersionsRestoreRequestType } from '../../shared/contracts/notes';
import { collectAttachmentRefs } from '../../shared/editor/doc-schema';
import { extractPlainText } from '../../shared/text/plain-text';
import { AUTO_VERSION_INTERVAL_MS, selectAutoVersionsToPrune, type AutoVersionPolicy } from '../../shared/versions/retention';
import type { Db } from '../db/driver';
import { AttachmentsRepo } from '../db/repositories/attachments-repo';
import { NotesRepo, serializedContent, storedContent, type ContentRow } from '../db/repositories/notes-repo';
import { VersionsRepo, type VersionReason, type VersionRow } from '../db/repositories/versions-repo';
import { AppError } from './app-error';
import type { ContentOps } from './content-ops';
import type { IdGenerator } from './ids';
import { MSG } from './messages';
import { normalizeContent } from './note-content';

const PREVIEW_CHARS = 200;
export const DEFAULT_VERSION_LIST_LIMIT = 100;

/** Saved copies of note content (D-056): automatic snapshots, snapshots before conversions and restores. */
export class VersionService {
  private readonly versions: VersionsRepo;
  private readonly attachments: AttachmentsRepo;
  private readonly notes: NotesRepo;

  constructor(
    private readonly deps: { db: Db; ids: IdGenerator; ops: ContentOps; autoPolicy: () => AutoVersionPolicy },
  ) {
    this.versions = new VersionsRepo(deps.db);
    this.attachments = new AttachmentsRepo(deps.db);
    this.notes = new NotesRepo(deps.db);
  }

  /** Saves the row's current content as a version; runs inside the caller's transaction. Returns the version id. */
  snapshot(row: ContentRow, reason: VersionReason, now: number): string {
    const id = this.deps.ids.uuid();
    const attachmentIds = row.format === 'rich' ? [...new Set(collectAttachmentRefs(storedContent(row)).map((r) => r.attachmentId))] : [];
    this.versions.insert({ id, noteId: row.id, revision: row.revision, format: row.format, content: serializedContent(row), attachmentIds, reason, now });
    return id;
  }

  /**
   * Before a save: keeps the stored content as an automatic version when the note has saved content and no
   * automatic version from the last 10 minutes, then prunes that note's automatic versions to the retention setting.
   */
  maybeAuto(row: ContentRow, now: number): void {
    if (row.revision < 1) return;
    if (row.plain_text === '' && !this.attachments.hasLinks(row.id)) return;
    if (this.versions.hasAutoSince(row.id, now - AUTO_VERSION_INTERVAL_MS)) return;
    this.snapshot(row, 'auto', now);
    this.versions.deleteIds(selectAutoVersionsToPrune(this.versions.autoVersions(row.id), now, this.deps.autoPolicy()));
  }

  /** Applies the retention setting to every note's automatic versions (after the setting changed, or over time). */
  pruneAutoVersions(now: number): number {
    const policy = this.deps.autoPolicy();
    return this.deps.db.transaction(() => {
      const ids = this.versions.notesWithAutoVersions().flatMap((noteId) => selectAutoVersionsToPrune(this.versions.autoVersions(noteId), now, policy));
      this.versions.deleteIds(ids);
      return ids.length;
    }, 'immediate');
  }

  list(noteId: string, limit = DEFAULT_VERSION_LIST_LIMIT): VersionsListResponseType {
    if (!this.notes.getContentRow(noteId)) throw new AppError('NOT_FOUND', MSG.missing);
    return { versions: this.versions.list(noteId, limit).map(summarize) };
  }

  /** Restores a version; the current content is saved as a `restore` version first. The title is kept. */
  restore(req: VersionsRestoreRequestType): NoteContentResponseType {
    return this.deps.ops.run(req, (row, now) => {
      const version = this.versions.get(req.noteId, req.versionId);
      if (!version) throw new AppError('NOT_FOUND', 'That version no longer exists.');
      const content = normalizeContent(version.format, version.format === 'rich' ? JSON.parse(version.content_snapshot) : version.content_snapshot);
      const versionId = this.snapshot(row, 'restore', now);
      return { format: version.format, content, versionId };
    });
  }
}

function summarize(v: VersionRow) {
  let preview = '';
  try {
    preview = extractPlainText(v.format, v.format === 'rich' ? JSON.parse(v.content_snapshot) : v.content_snapshot).slice(0, PREVIEW_CHARS);
  } catch {
    // An unreadable snapshot still lists, without a preview.
  }
  const ids: unknown = JSON.parse(v.attachment_ids);
  return {
    id: v.id,
    revision: v.revision,
    format: v.format,
    reason: v.reason,
    createdAt: v.created_at,
    preview,
    attachmentCount: Array.isArray(ids) ? ids.length : 0,
  };
}
