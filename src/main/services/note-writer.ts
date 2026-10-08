import {
  MAX_CONTENT_BYTES,
  NOTE_TOO_LARGE_MESSAGE,
  type NoteRevisionEventType,
  type NoteSaveAckType,
  type NoteSaveRequestType,
} from '../../shared/contracts/notes';
import type { Db } from '../db/driver';
import { DraftsRepo } from '../db/repositories/drafts-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import { AppError, errorDetail } from './app-error';
import type { Clock } from './clock';
import type { IdGenerator } from './ids';
import type { LeaseManager } from './lease-manager';
import type { Logger } from './logger';
import { MSG } from './messages';
import { normalizeContent, type NoteContent, type NoteContentValue } from './note-content';
import { RequestCache } from './request-cache';
import type { VersionService } from './version-service';

/** Test-only fault injection (installed by the E2E test hooks, never in a packaged build). */
export interface SaveFaults {
  beforeSave(): void;
}

export interface NoteWriterDeps {
  db: Db;
  leases: LeaseManager;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  content: NoteContent;
  versions: VersionService;
  emit: (event: NoteRevisionEventType) => void;
  faults?: SaveFaults;
}

type SaveOutcome =
  | { kind: 'ok'; ack: NoteSaveAckType }
  | { kind: 'conflict'; currentRevision: number; draftId: string; reason: 'stale' | 'trashed' };

/**
 * Applies `note:save` (ARCHITECTURE 6, plan section 8.1): verifies the lease and the base revision, validates
 * the document, writes the next revision with its index and automatic version, and keeps rejected content as a
 * draft. Outcomes are cached per requestId, so a retried request returns the same ack or the same rejection
 * (and draft) without writing twice (F-01-3).
 */
export class NoteWriter {
  private readonly outcomes = new RequestCache<NoteSaveAckType | AppError>();
  private readonly notes: NotesRepo;
  private readonly drafts: DraftsRepo;

  constructor(private readonly deps: NoteWriterDeps) {
    this.notes = new NotesRepo(deps.db);
    this.drafts = new DraftsRepo(deps.db);
  }

  save(req: NoteSaveRequestType, ctx: { webContentsId: number }): NoteSaveAckType {
    const serialized = typeof req.content === 'string' ? req.content : JSON.stringify(req.content);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CONTENT_BYTES) throw new AppError('LIMIT_EXCEEDED', NOTE_TOO_LARGE_MESSAGE);
    this.deps.faults?.beforeSave();

    const lease = this.deps.leases.verify(req.noteId, req.viewId, req.leaseToken, ctx.webContentsId);
    if (lease === 'forbidden') throw new AppError('FORBIDDEN', 'Not allowed');

    const cached = this.outcomes.get(req.noteId, req.requestId);
    if (cached instanceof AppError) throw cached;
    if (cached) return cached;

    if (lease === 'lost') {
      if (!this.notes.getContentRow(req.noteId)) throw new AppError('NOT_FOUND', MSG.missing);
      const draftId = this.insertDraft(req, serialized, 'lease_lost');
      throw this.reject(req, new AppError('LEASE_REQUIRED', 'Edit control was lost', { draftId }));
    }

    const content = normalizeContent(req.format, req.content);
    let outcome: SaveOutcome;
    try {
      outcome = this.deps.db.transaction(() => this.write(req, content), 'immediate');
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.deps.logger.error(`save failed note=${req.noteId} ${errorDetail(err)}`);
      throw new AppError('INTERNAL', 'Could not save the note');
    }

    if (outcome.kind === 'conflict') {
      const { currentRevision, draftId, reason } = outcome;
      throw this.reject(req, new AppError('CONFLICT', 'This note changed elsewhere', { currentRevision, draftId, reason }));
    }
    this.outcomes.set(req.noteId, req.requestId, outcome.ack);
    this.deps.emit({ noteId: req.noteId, revision: outcome.ack.revision, sourceViewId: req.viewId });
    return outcome.ack;
  }

  /** Runs inside the save transaction. A trashed or stale note keeps the content as a conflict draft. */
  private write(req: NoteSaveRequestType, content: NoteContentValue): SaveOutcome {
    const row = this.notes.getContentRow(req.noteId);
    if (!row) throw new AppError('NOT_FOUND', MSG.missing);
    if (row.deleted_at !== null || row.revision !== req.baseRevision) {
      const serialized = typeof content === 'string' ? content : JSON.stringify(content);
      const draftId = this.insertDraft(req, serialized, 'conflict');
      return { kind: 'conflict', currentRevision: row.revision, draftId, reason: row.deleted_at !== null ? 'trashed' : 'stale' };
    }
    if (row.format !== req.format) throw new AppError('VALIDATION_FAILED', 'Format conversion is not part of a plain save');
    const now = this.deps.clock.now();
    this.deps.versions.maybeAuto(row, now);
    const written = this.deps.content.write({
      noteId: req.noteId,
      format: req.format,
      content,
      title: req.title ?? null,
      expectedRevision: row.revision,
      now,
    });
    return { kind: 'ok', ack: { noteId: req.noteId, revision: written.revision, requestId: req.requestId, updatedAt: written.updatedAt } };
  }

  /** Remembers a rejection that stored a draft, so a retry returns it again instead of storing a second draft. */
  private reject(req: NoteSaveRequestType, error: AppError): AppError {
    this.outcomes.set(req.noteId, req.requestId, error);
    return error;
  }

  private insertDraft(req: NoteSaveRequestType, serialized: string, reason: 'conflict' | 'lease_lost'): string {
    const id = this.deps.ids.uuid();
    this.drafts.insert({
      id,
      noteId: req.noteId,
      viewId: req.viewId,
      baseRevision: req.baseRevision,
      format: req.format,
      title: req.title,
      content: serialized,
      reason,
      now: this.deps.clock.now(),
    });
    return id;
  }
}
