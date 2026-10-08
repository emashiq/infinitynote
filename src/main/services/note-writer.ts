import { MAX_CONTENT_BYTES, type NoteRevisionEventType, type NoteSaveAckType, type NoteSaveRequestType } from '../../shared/contracts/notes';
import { extractPlainText } from '../../shared/text/plain-text';
import type { Db } from '../db/driver';
import { NotesRepo } from '../db/repositories/notes-repo';
import { AppError } from './app-error';
import type { Clock } from './clock';
import type { IdGenerator } from './ids';
import type { LeaseManager } from './lease-manager';

export interface NoteWriterDeps {
  db: Db;
  leases: LeaseManager;
  clock: Clock;
  ids: IdGenerator;
  emit: (event: NoteRevisionEventType) => void;
  extract?: typeof extractPlainText;
}

type SaveOutcome =
  | { kind: 'ok'; ack: NoteSaveAckType }
  | { kind: 'conflict'; currentRevision: number; draftId: string; reason: 'stale' | 'trashed' };

const ACK_CACHE_PER_NOTE = 100;

/**
 * The single writer of note content (ARCHITECTURE 6): verifies the lease and the base revision, writes the
 * next revision, and keeps rejected content as a draft. Acks are cached per requestId so a retry is idempotent.
 */
export class NoteWriter {
  private readonly acks = new Map<string, Map<string, NoteSaveAckType>>();
  private readonly notes: NotesRepo;
  private readonly extract: typeof extractPlainText;

  constructor(private readonly deps: NoteWriterDeps) {
    this.notes = new NotesRepo(deps.db);
    this.extract = deps.extract ?? extractPlainText;
  }

  save(req: NoteSaveRequestType, ctx: { webContentsId: number }): NoteSaveAckType {
    const serialized = typeof req.content === 'string' ? req.content : JSON.stringify(req.content);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CONTENT_BYTES) {
      throw new AppError('LIMIT_EXCEEDED', 'Note is too large to save');
    }

    const lease = this.deps.leases.verify(req.noteId, req.viewId, req.leaseToken, ctx.webContentsId);
    if (lease === 'forbidden') throw new AppError('FORBIDDEN', 'Not allowed');
    if (lease === 'lost') {
      if (!this.notes.getSaveState(req.noteId)) throw new AppError('NOT_FOUND', 'Note not found');
      const draftId = this.insertDraft(req, serialized, 'lease_lost');
      throw new AppError('LEASE_REQUIRED', 'Edit control was lost', { draftId });
    }

    const cached = this.acks.get(req.noteId)?.get(req.requestId);
    if (cached) return cached;

    let outcome: SaveOutcome;
    try {
      outcome = this.deps.db.transaction(() => this.write(req, serialized), 'immediate');
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('INTERNAL', 'Could not save the note');
    }

    if (outcome.kind === 'conflict') {
      const { currentRevision, draftId, reason } = outcome;
      throw new AppError('CONFLICT', 'This note changed elsewhere', { currentRevision, draftId, reason });
    }
    this.remember(outcome.ack);
    this.deps.emit({ noteId: req.noteId, revision: outcome.ack.revision, sourceViewId: req.viewId });
    return outcome.ack;
  }

  /** Runs inside the save transaction. A trashed or stale note keeps the content as a conflict draft. */
  private write(req: NoteSaveRequestType, serialized: string): SaveOutcome {
    const note = this.notes.getSaveState(req.noteId);
    if (!note) throw new AppError('NOT_FOUND', 'Note not found');
    if (note.deleted_at !== null || note.revision !== req.baseRevision) {
      const draftId = this.insertDraft(req, serialized, 'conflict');
      return { kind: 'conflict', currentRevision: note.revision, draftId, reason: note.deleted_at !== null ? 'trashed' : 'stale' };
    }
    if (note.format !== req.format) {
      throw new AppError('VALIDATION_FAILED', 'Format conversion is not part of a plain save');
    }
    const now = this.deps.clock.now();
    const revision = note.revision + 1;
    this.notes.writeContent({
      id: req.noteId,
      format: req.format,
      content: serialized,
      plainText: this.extract(req.format, req.content),
      title: req.title,
      revision,
      now,
    });
    return { kind: 'ok', ack: { noteId: req.noteId, revision, requestId: req.requestId, updatedAt: now } };
  }

  private insertDraft(req: NoteSaveRequestType, serialized: string, reason: 'conflict' | 'lease_lost'): string {
    const id = this.deps.ids.uuid();
    this.notes.insertDraft({
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

  private remember(ack: NoteSaveAckType): void {
    let cache = this.acks.get(ack.noteId);
    if (!cache) {
      cache = new Map();
      this.acks.set(ack.noteId, cache);
    }
    cache.set(ack.requestId, ack);
    if (cache.size > ACK_CACHE_PER_NOTE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
}
