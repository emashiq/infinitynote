import type { Node as PmNode, Schema } from '@tiptap/pm/model';
import { Step, Transform } from '@tiptap/pm/transform';
import type { EventPayload } from '../../shared/contracts/channels';
import type {
  CollabFlushResponseType,
  CollabPullResponseType,
  CollabPushRequestType,
  CollabPushResponseType,
  CollabSnapshotType,
} from '../../shared/contracts/collab';
import { MAX_CONTENT_BYTES, NOTE_TOO_LARGE_MESSAGE, SAVE_RETRIES, SAVE_RETRY_DELAY_MS, type NoteRevisionEventType } from '../../shared/contracts/notes';
import { BLOCK_ID_TYPES } from '../../shared/editor/doc-schema';
import { toSavable } from '../../shared/editor/savable';
import { noteSchema } from '../../shared/editor/schema';
import { docToText, textToDoc } from '../../shared/text/textarea-doc';
import type { Db } from '../db/driver';
import { DraftsRepo } from '../db/repositories/drafts-repo';
import { NotesRepo, type ContentRow } from '../db/repositories/notes-repo';
import { AppError, errorDetail } from './app-error';
import type { Clock } from './clock';
import type { IdGenerator } from './ids';
import type { Logger } from './logger';
import { MSG } from './messages';
import { normalizeContent, type NoteContent, type NoteContentValue } from './note-content';
import type { SaveFaults } from './note-writer';
import { realTimers, type Timers } from './timers';
import type { VersionService } from './version-service';

/** The view id main's own saves are announced with (note:revision), so the hub can tell them from other writers. */
export const HUB_VIEW_ID = 'c011ab00-0000-4000-8000-000000000000';
/** Saves follow the last edit after this long, like the editor's debounce did before main saved (D-055). */
export const HUB_SAVE_DELAY_MS = 400;
/** Confirmed steps kept for views that fell behind; a view further behind joins again. */
export const STEP_LOG_LIMIT = 2000;
/** The authoritative document may outgrow what a note stores (saving then fails visibly) but not without bound. */
export const MAX_SESSION_DOC_SIZE = 4 * MAX_CONTENT_BYTES;

const STEPS_REFUSED = 'These edits could not be applied';
const UNREADABLE = 'This note could not be opened';

type CollabEvent = 'collab:steps' | 'collab:reset' | 'collab:status';

export interface CollabHubDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  content: NoteContent;
  versions: VersionService;
  emitRevision: (event: NoteRevisionEventType) => void;
  send: <C extends CollabEvent>(webContentsId: number, channel: C, payload: EventPayload<C>) => void;
  faults?: SaveFaults;
  timers?: Timers;
  saveDelayMs?: number;
  retryDelayMs?: number;
}

/** What the authoritative document holds that the stored note does not. */
type Unsaved = 'none' | 'normalized' | 'edits';

/** The part of a session that starts over when the stored note is loaded again. */
interface Loaded {
  format: 'rich' | 'plain';
  schema: Schema;
  epoch: string;
  doc: PmNode;
  version: number;
  /** Confirmed steps from version `logStart` on, with the view that sent each. */
  log: Array<{ step: Step; clientID: string }>;
  logStart: number;
  /** The stored revision the document is based on. */
  revision: number;
  savedVersion: number;
  unsaved: Unsaved;
}

interface Session extends Loaded {
  noteId: string;
  members: Map<string, number>;
  timer: unknown;
  saving: Promise<number> | null;
}

/**
 * The central authority of live sync (D-103): one session per open note holds the authoritative document. Views join,
 * push their steps at the version they are based on, and receive every confirmed step (theirs included, which
 * confirms them). Main saves the document through the transactional save path a short while after the last edit and
 * when a view flushes, so every view of a note edits at once and all see the same text. A write from outside the
 * session (a conversion, a restore, another writer) starts the session over; edits it could not save are kept as a
 * recovered draft.
 */
export class CollabHub {
  private readonly sessions = new Map<string, Session>();
  private readonly bindings = new Map<string, number>();
  private readonly notes: NotesRepo;
  private readonly drafts: DraftsRepo;
  private readonly timers: Timers;

  constructor(private readonly deps: CollabHubDeps) {
    this.notes = new NotesRepo(deps.db);
    this.drafts = new DraftsRepo(deps.db);
    this.timers = deps.timers ?? realTimers;
  }

  // Views ----------------------------------------------------------------------------------------------------------
  join(noteId: string, viewId: string, webContentsId: number): CollabSnapshotType {
    this.bind(viewId, webContentsId);
    const session = this.sessions.get(noteId) ?? this.open(noteId);
    session.members.set(viewId, webContentsId);
    return { epoch: session.epoch, version: session.version, format: session.format, doc: session.doc.toJSON(), revision: session.revision };
  }

  leave(noteId: string, viewId: string, webContentsId: number): { left: boolean } {
    const session = this.memberSession(noteId, viewId, webContentsId);
    if (!session) return { left: false };
    session.members.delete(viewId);
    if (session.members.size === 0) this.close(session);
    return { left: true };
  }

  push(req: CollabPushRequestType, webContentsId: number): CollabPushResponseType {
    const session = this.memberSession(req.noteId, req.viewId, webContentsId);
    if (!session || session.epoch !== req.epoch) return { status: 'reset' };
    if (req.version !== session.version) return { status: 'behind', version: session.version };
    let doc = session.doc;
    const steps: Step[] = [];
    try {
      for (const json of req.steps) {
        const step = Step.fromJSON(session.schema, json);
        const result = step.apply(doc);
        if (!result.doc) throw new Error(result.failed ?? 'step failed');
        doc = result.doc;
        steps.push(step);
      }
    } catch (err) {
      this.deps.logger.warn(`collab: refused steps note=${req.noteId} ${errorDetail(err)}`);
      throw new AppError('VALIDATION_FAILED', STEPS_REFUSED);
    }
    if (doc.content.size > MAX_SESSION_DOC_SIZE) throw new AppError('LIMIT_EXCEEDED', NOTE_TOO_LARGE_MESSAGE);

    const start = session.version;
    session.doc = doc;
    session.version += steps.length;
    session.log.push(...steps.map((step) => ({ step, clientID: req.viewId })));
    if (session.log.length > STEP_LOG_LIMIT) {
      const drop = session.log.length - STEP_LOG_LIMIT;
      session.log.splice(0, drop);
      session.logStart += drop;
    }
    session.unsaved = 'edits';
    this.scheduleSave(session);
    this.sendAll(session, 'collab:steps', {
      noteId: session.noteId,
      epoch: session.epoch,
      version: start,
      steps: req.steps,
      clientIDs: steps.map(() => req.viewId),
    });
    return { status: 'accepted', version: session.version };
  }

  /** The confirmed steps a view has not seen, from its version on. */
  pull(req: { noteId: string; viewId: string; epoch: string; version: number }, webContentsId: number): CollabPullResponseType {
    const session = this.memberSession(req.noteId, req.viewId, webContentsId);
    if (!session || session.epoch !== req.epoch || req.version < session.logStart || req.version > session.version) return { status: 'reset' };
    const missing = session.log.slice(req.version - session.logStart);
    return {
      status: 'steps',
      version: req.version,
      steps: missing.map((s) => s.step.toJSON() as { stepType: string }),
      clientIDs: missing.map((s) => s.clientID),
    };
  }

  /**
   * Saves the document now (with retries) and resolves with the stored revision, or fails as the save did; edits kept
   * as a recovered draft fail with CONFLICT and its id. A view that is not in the session has nothing in main to save.
   */
  async flush(req: { noteId: string; viewId: string; force?: boolean }, webContentsId: number): Promise<CollabFlushResponseType> {
    const session = this.memberSession(req.noteId, req.viewId, webContentsId);
    if (!session) {
      const row = this.notes.getContentRow(req.noteId);
      if (!row) throw new AppError('NOT_FOUND', MSG.missing);
      return { revision: row.revision };
    }
    if (req.force && session.unsaved === 'normalized') session.unsaved = 'edits';
    return { revision: await this.save(session) };
  }

  // Main-side hooks ------------------------------------------------------------------------------------------------
  /**
   * Before a content operation (conversion, restore) writes: the session's edits are saved first, so the operation
   * starts from them. Throws when they cannot be saved.
   */
  settle(noteId: string): void {
    const session = this.sessions.get(noteId);
    if (!session || session.unsaved !== 'edits') return;
    this.cancelSave(session);
    this.saveOnce(session);
  }

  /** Any stored revision: one written outside the session starts it over from the stored note. */
  onRevision(event: NoteRevisionEventType): void {
    if (event.sourceViewId === HUB_VIEW_ID) return;
    const session = this.sessions.get(event.noteId);
    if (!session || event.revision <= session.revision) return;
    const conflict = session.unsaved === 'edits' ? { draftId: this.keepAsDraft(session), reason: 'stale' as const } : null;
    this.restart(session, conflict);
  }

  /** The renderer document of a window went away: its views leave, and sessions without views close. */
  webContentsReset(webContentsId: number): void {
    for (const [viewId, bound] of [...this.bindings]) if (bound === webContentsId) this.bindings.delete(viewId);
    for (const session of [...this.sessions.values()]) {
      for (const [viewId, bound] of [...session.members]) if (bound === webContentsId) session.members.delete(viewId);
      if (session.members.size === 0) this.close(session);
    }
  }

  /** Before quitting: every session's edits are saved (or kept as a draft). */
  closeAll(): void {
    for (const session of [...this.sessions.values()]) this.close(session);
  }

  /** The authoritative document of an open note (tests and diagnostics). */
  documentOf(noteId: string): PmNode | null {
    return this.sessions.get(noteId)?.doc ?? null;
  }

  // Sessions -------------------------------------------------------------------------------------------------------
  private bind(viewId: string, webContentsId: number): void {
    const bound = this.bindings.get(viewId);
    if (bound !== undefined && bound !== webContentsId) throw new AppError('FORBIDDEN', 'This view belongs to another window');
    this.bindings.set(viewId, webContentsId);
  }

  private memberSession(noteId: string, viewId: string, webContentsId: number): Session | null {
    const bound = this.bindings.get(viewId);
    if (bound !== undefined && bound !== webContentsId) throw new AppError('FORBIDDEN', 'This view belongs to another window');
    const session = this.sessions.get(noteId);
    return session && session.members.get(viewId) === webContentsId ? session : null;
  }

  private open(noteId: string): Session {
    const session: Session = { noteId, ...this.load(noteId), members: new Map(), timer: null, saving: null };
    this.sessions.set(noteId, session);
    return session;
  }

  /** The stored note as a session starts (again) from it: a new epoch at version 0. */
  private load(noteId: string): Loaded {
    const row = this.notes.getContentRow(noteId);
    if (!row) throw new AppError('NOT_FOUND', MSG.missing);
    if (row.deleted_at !== null) throw new AppError('NOT_FOUND', MSG.noteInTrash, { trashed: true, trashBatchId: row.trash_batch_id });
    const schema = noteSchema(row.format);
    let doc: PmNode;
    try {
      doc = schema.nodeFromJSON(row.format === 'rich' ? JSON.parse(row.content_json ?? '{"type":"doc"}') : textToDoc(row.content_text ?? ''));
      doc.check();
    } catch (err) {
      this.deps.logger.error(`collab: stored note ${noteId} does not fit the editor schema ${errorDetail(err)}`);
      throw new AppError('INTERNAL', UNREADABLE);
    }
    const prepared = row.format === 'rich' ? this.prepareRich(doc) : doc;
    return {
      format: row.format,
      schema,
      epoch: this.deps.ids.uuid(),
      doc: prepared,
      version: 0,
      log: [],
      logStart: 0,
      revision: row.revision,
      savedVersion: 0,
      unsaved: prepared === doc ? 'none' : 'normalized',
    };
  }

  /**
   * What every editor would otherwise do when it opens a rich note, done once for all views: block IDs where they are
   * missing (UniqueID) and a closing paragraph (TrailingNode). Opening alone never saves them (D-055).
   */
  private prepareRich(doc: PmNode): PmNode {
    const tr = new Transform(doc);
    doc.descendants((node, pos) => {
      if ((BLOCK_ID_TYPES as readonly string[]).includes(node.type.name) && !node.attrs.id) tr.setNodeAttribute(pos, 'id', this.deps.ids.uuid());
    });
    if (doc.lastChild?.type.name !== 'paragraph') tr.insert(tr.doc.content.size, doc.type.schema.nodes.paragraph!.create({ id: this.deps.ids.uuid() }));
    return tr.docChanged ? tr.doc : doc;
  }

  private restart(session: Session, conflict: { draftId: string; reason: 'stale' | 'trashed' } | null): void {
    this.cancelSave(session);
    const members = [...new Set(session.members.values())];
    try {
      Object.assign(session, this.load(session.noteId));
    } catch {
      // Gone or in Trash: the views learn it when they join again.
      this.sessions.delete(session.noteId);
    }
    for (const webContentsId of members) this.deps.send(webContentsId, 'collab:reset', { noteId: session.noteId, conflict });
  }

  private close(session: Session): void {
    this.cancelSave(session);
    this.sessions.delete(session.noteId);
    if (session.unsaved !== 'edits') return;
    try {
      this.saveOnce(session);
    } catch (err) {
      this.deps.logger.error(`collab: closing note ${session.noteId} could not save ${errorDetail(err)}; keeping a recovered draft`);
      try {
        this.keepAsDraft(session);
      } catch (draftErr) {
        this.deps.logger.error(`collab: the draft of note ${session.noteId} could not be kept ${errorDetail(draftErr)}`);
      }
    }
  }

  private sendAll<C extends CollabEvent>(session: Session, channel: C, payload: EventPayload<C>): void {
    for (const webContentsId of new Set(session.members.values())) this.deps.send(webContentsId, channel, payload);
  }

  // Saving ---------------------------------------------------------------------------------------------------------
  private scheduleSave(session: Session): void {
    this.cancelSave(session);
    session.timer = this.timers.setTimeout(() => {
      session.timer = null;
      void this.save(session).catch(() => undefined);
    }, this.deps.saveDelayMs ?? HUB_SAVE_DELAY_MS);
  }

  private cancelSave(session: Session): void {
    if (session.timer === null) return;
    this.timers.clearTimeout(session.timer);
    session.timer = null;
  }

  /** One save at a time per note; INTERNAL failures are retried, and every outcome is announced to the views. */
  private save(session: Session): Promise<number> {
    this.cancelSave(session);
    const previous = session.saving ?? Promise.resolve(0);
    const run = previous
      .catch(() => 0)
      .then(async () => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            return this.saveOnce(session);
          } catch (err) {
            const error = err instanceof AppError ? err : new AppError('INTERNAL', 'Could not save the note');
            if (error.code === 'INTERNAL' && attempt < SAVE_RETRIES && this.sessions.get(session.noteId) === session) {
              this.announce(session, 'retrying', error.message);
              await new Promise<void>((resolve) => this.timers.setTimeout(resolve, this.deps.retryDelayMs ?? SAVE_RETRY_DELAY_MS));
              continue;
            }
            if (error.code !== 'CONFLICT') this.announce(session, 'error', error.message);
            throw error;
          }
        }
      });
    session.saving = run;
    void run.finally(() => {
      if (session.saving === run) session.saving = null;
    }).catch(() => undefined);
    return run;
  }

  /** Saves the document if it holds edits; returns the stored revision. Conflicts keep the edits as a draft. */
  private saveOnce(session: Session): number {
    if (session.unsaved !== 'edits') return session.revision;
    const content = this.savable(session);
    const serialized = typeof content === 'string' ? content : JSON.stringify(content);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CONTENT_BYTES) throw new AppError('LIMIT_EXCEEDED', NOTE_TOO_LARGE_MESSAGE);
    this.deps.faults?.beforeSave();

    const version = session.version;
    const now = this.deps.clock.now();
    const outcome = this.deps.db.transaction((): { kind: 'ok'; revision: number } | { kind: 'conflict'; row: ContentRow; draftId: string } => {
      const row = this.notes.getContentRow(session.noteId);
      if (!row) throw new AppError('NOT_FOUND', MSG.missing);
      if (row.deleted_at !== null || row.revision !== session.revision || row.format !== session.format) {
        return { kind: 'conflict', row, draftId: this.insertDraft(session, serialized) };
      }
      this.deps.versions.maybeAuto(row, now);
      const written = this.deps.content.write({ noteId: session.noteId, format: session.format, content, title: null, expectedRevision: row.revision, now });
      return { kind: 'ok', revision: written.revision };
    }, 'immediate');

    if (outcome.kind === 'conflict') {
      const reason = outcome.row.deleted_at !== null ? ('trashed' as const) : ('stale' as const);
      session.unsaved = 'none';
      this.restart(session, { draftId: outcome.draftId, reason });
      throw new AppError('CONFLICT', 'This note changed elsewhere', { currentRevision: outcome.row.revision, draftId: outcome.draftId, reason });
    }
    session.revision = outcome.revision;
    session.savedVersion = version;
    session.unsaved = 'none';
    this.deps.emitRevision({ noteId: session.noteId, revision: outcome.revision, sourceViewId: HUB_VIEW_ID });
    this.announce(session, 'saved', null);
    return outcome.revision;
  }

  private savable(session: Session): NoteContentValue {
    const json = session.doc.toJSON() as { content?: unknown[] };
    return session.format === 'rich' ? normalizeContent('rich', toSavable(json)) : docToText(json);
  }

  private announce(session: Session, state: 'saved' | 'retrying' | 'error', message: string | null): void {
    this.sendAll(session, 'collab:status', {
      noteId: session.noteId,
      epoch: session.epoch,
      savedVersion: session.savedVersion,
      revision: session.revision,
      state,
      message,
    });
  }

  /** Keeps the session's unsaved document as a recovered draft; returns its id. */
  private keepAsDraft(session: Session): string {
    let serialized: string;
    try {
      const content = this.savable(session);
      serialized = typeof content === 'string' ? content : JSON.stringify(content);
    } catch {
      serialized = JSON.stringify(session.doc.toJSON());
    }
    return this.deps.db.transaction(() => this.insertDraft(session, serialized), 'immediate');
  }

  private insertDraft(session: Session, serialized: string): string {
    const id = this.deps.ids.uuid();
    this.drafts.insert({
      id,
      noteId: session.noteId,
      viewId: HUB_VIEW_ID,
      baseRevision: session.revision,
      format: session.format,
      content: serialized,
      reason: 'conflict',
      now: this.deps.clock.now(),
    });
    return id;
  }
}
