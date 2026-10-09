import type { ContentOpBaseType, NoteContentResponseType, NoteRevisionEventType } from '../../shared/contracts/notes';
import type { Db } from '../db/driver';
import { NotesRepo, type ContentRow } from '../db/repositories/notes-repo';
import { AppError } from './app-error';
import type { Clock } from './clock';
import type { Logger } from './logger';
import { MSG } from './messages';
import type { NoteContent, NoteContentValue } from './note-content';
import { RequestCache } from './request-cache';
import { runTx } from './transaction';

/** What a content operation writes, computed from the current row inside the transaction. */
export interface ContentChange {
  format: 'rich' | 'plain';
  content: NoteContentValue;
  /** New title, or omitted to keep the current one. */
  title?: string | null;
  /** The version saved before the change, returned to the renderer (for example "Restore formatted version"). */
  versionId: string | null;
}

export interface ContentOpsDeps {
  db: Db;
  /** Saves the live-sync session's edits first, so the operation starts from them (D-103). */
  settle: (noteId: string) => void;
  clock: Clock;
  logger: Logger;
  content: NoteContent;
  emit: (event: NoteRevisionEventType) => void;
}

/**
 * The guard shared by format conversion, version restore and draft restore (plan section 8.6): open views' edits are
 * saved first, the note must be live and at the base revision, and the change commits in one transaction. No user
 * content is submitted, so a stale base stores no draft. Successful results are cached per requestId so a retry is
 * idempotent; the revision event starts the note's live-sync session over (D-103).
 */
export class ContentOps {
  private readonly results = new RequestCache<NoteContentResponseType>();
  private readonly notes: NotesRepo;

  constructor(private readonly deps: ContentOpsDeps) {
    this.notes = new NotesRepo(deps.db);
  }

  run(req: ContentOpBaseType, change: (row: ContentRow, now: number) => ContentChange): NoteContentResponseType {
    const cached = this.results.get(req.noteId, req.requestId);
    if (cached) return cached;
    this.deps.settle(req.noteId);

    const response = runTx(this.deps.db, this.deps.logger, () => {
      const row = this.notes.getContentRow(req.noteId);
      if (!row) throw new AppError('NOT_FOUND', MSG.missing);
      if (row.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.noteInTrash, { trashed: true, trashBatchId: row.trash_batch_id });
      if (row.revision !== req.baseRevision) {
        throw new AppError('CONFLICT', 'This note changed elsewhere', { currentRevision: row.revision, reason: 'stale' });
      }
      const now = this.deps.clock.now();
      const c = change(row, now);
      const written = this.deps.content.write({
        noteId: req.noteId,
        format: c.format,
        content: c.content,
        title: c.title ?? null,
        expectedRevision: row.revision,
        now,
      });
      return { noteId: req.noteId, revision: written.revision, format: c.format, content: c.content, versionId: c.versionId, updatedAt: now };
    });
    this.results.set(req.noteId, req.requestId, response);
    this.deps.emit({ noteId: req.noteId, revision: response.revision, sourceViewId: req.viewId });
    return response;
  }
}
