import { MAX_CONTENT_BYTES, type NoteRevisionEventType, type NoteSaveAckType, type NoteSaveRequestType } from '../../shared/contracts/notes';
import { extractPlainText } from '../../shared/text/plain-text';
import type { Db } from '../db/driver';
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

interface NoteState {
  format: string;
  revision: number;
  deleted_at: number | null;
}

type TxResult =
  | { kind: 'ok'; ack: NoteSaveAckType }
  | { kind: 'conflict'; currentRevision: number; draftId: string; reason: 'stale' | 'trashed' };

const ACK_CACHE_PER_NOTE = 100;

export class NoteWriter {
  private readonly acks = new Map<string, Map<string, NoteSaveAckType>>();
  private readonly extract: typeof extractPlainText;

  constructor(private readonly deps: NoteWriterDeps) {
    this.extract = deps.extract ?? extractPlainText;
  }

  private serialize(req: NoteSaveRequestType): string {
    return typeof req.content === 'string' ? req.content : JSON.stringify(req.content);
  }

  private insertDraft(req: NoteSaveRequestType, serialized: string, reason: 'conflict' | 'lease_lost'): string {
    const id = this.deps.ids.uuid();
    this.deps.db
      .prepare<[string, string, string, number, string, string | null, string, string, number]>(
        'INSERT INTO note_drafts(id, note_id, view_id, base_revision, format, title, content, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, req.noteId, req.viewId, req.baseRevision, req.format, req.title ?? null, serialized, reason, this.deps.clock.now());
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

  save(req: NoteSaveRequestType, ctx: { webContentsId: number }): NoteSaveAckType {
    const { db } = this.deps;
    const serialized = this.serialize(req);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CONTENT_BYTES) {
      throw new AppError('LIMIT_EXCEEDED', 'Note is too large to save');
    }

    const lease = this.deps.leases.verify(req.noteId, req.viewId, req.leaseToken, ctx.webContentsId);
    if (lease === 'forbidden') throw new AppError('FORBIDDEN', 'Not allowed');
    if (lease === 'lost') {
      const exists = db.prepare<[string], { revision: number }>('SELECT revision FROM notes WHERE id = ?').get(req.noteId);
      if (!exists) throw new AppError('NOT_FOUND', 'Note not found');
      const draftId = this.insertDraft(req, serialized, 'lease_lost');
      throw new AppError('LEASE_REQUIRED', 'Edit control was lost', { draftId });
    }

    const cached = this.acks.get(req.noteId)?.get(req.requestId);
    if (cached) return cached;

    let result: TxResult;
    try {
      result = db.transaction((): TxResult => {
        const note = db
          .prepare<[string], NoteState>('SELECT format, revision, deleted_at FROM notes WHERE id = ?')
          .get(req.noteId);
        if (!note) throw new AppError('NOT_FOUND', 'Note not found');
        if (note.deleted_at !== null) {
          const draftId = this.insertDraft(req, serialized, 'conflict');
          return { kind: 'conflict', currentRevision: note.revision, draftId, reason: 'trashed' };
        }
        if (note.revision !== req.baseRevision) {
          const draftId = this.insertDraft(req, serialized, 'conflict');
          return { kind: 'conflict', currentRevision: note.revision, draftId, reason: 'stale' };
        }
        if (note.format !== req.format) {
          throw new AppError('VALIDATION_FAILED', 'Format conversion is not part of a plain save');
        }
        const now = this.deps.clock.now();
        const revision = note.revision + 1;
        const plain = this.extract(req.format, req.content);
        db.prepare<[string | null, string | null, string, string | null, number, number, string]>(
          'UPDATE notes SET content_json = ?, content_text = ?, plain_text = ?, title = COALESCE(?, title), revision = ?, updated_at = ? WHERE id = ?',
        ).run(
          req.format === 'rich' ? serialized : null,
          req.format === 'plain' ? serialized : null,
          plain,
          req.title ?? null,
          revision,
          now,
          req.noteId,
        );
        return { kind: 'ok', ack: { noteId: req.noteId, revision, requestId: req.requestId, updatedAt: now } };
      }, 'immediate');
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('INTERNAL', 'Could not save the note');
    }

    if (result.kind === 'conflict') {
      throw new AppError('CONFLICT', 'This note changed elsewhere', {
        currentRevision: result.currentRevision,
        draftId: result.draftId,
        reason: result.reason,
      });
    }
    this.remember(result.ack);
    this.deps.emit({ noteId: req.noteId, revision: result.ack.revision, sourceViewId: req.viewId });
    return result.ack;
  }
}
