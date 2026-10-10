import { IMPORT_WAIT_ON_FLUSH_MS } from '../../shared/attachments/limits';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { CollabResetEventType, CollabSnapshotType, CollabStatusEventType, CollabStepsEventType } from '../../shared/contracts/collab';
import type { ErrorEnvelope, Result } from '../../shared/contracts/envelope';
import type { NoteSummaryType } from '../../shared/contracts/hierarchy';
import type { DraftSummaryType, VersionSummaryType } from '../../shared/contracts/notes';
import type { RichDocLike } from '../../shared/editor/doc-schema';
import { validateTitle, normalizeTitle } from '../../shared/names';
import type { ContentSource, EditorHost } from '../editor/content';
import { createDebouncer, createStore, type Store, type Timers } from '../state/store';

/** `locked`: the note is locked and its key is not in main's memory; the tab shows the lock screen (D-111). */
export type NoteStatus = 'loading' | 'ready' | 'trashed' | 'missing' | 'error' | 'locked';
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'retrying' | 'error';
export type Busy = 'convert' | 'restore' | 'draft' | null;

export interface NoteControllerState {
  status: NoteStatus;
  note: NoteSummaryType | null;
  title: string;
  format: 'rich' | 'plain';
  /** The stored revision this view's text is based on. */
  revision: number;
  /** The editor document the editor is created from (both formats), at live-sync version `syncVersion`. */
  content: RichDocLike | null;
  syncVersion: number;
  /** Changes when the editor must be created again (the document was replaced from outside). */
  contentKey: number;
  save: SaveStatus;
  message?: string;
  titleError?: string;
  trashBatchId?: string | null;
  drafts: DraftSummaryType[];
  /** The draft that keeps edits main could not save on top of a change made elsewhere. */
  conflict: { draftId: string; reason: 'stale' } | null;
  /** Set after a rich-to-plain conversion: the version to restore the formatting from. */
  converted: { versionId: string } | null;
  busy: Busy;
  /** The block the editor's cursor is in, for reminders on the current paragraph (D-080). */
  cursorBlockId: string | null;
  /** A block to scroll to, select and highlight once (a reminder opened the note); the nonce repeats a request. */
  reveal: { blockId: string; nonce: number } | null;
}

export type FlushResult = { ok: true } | { ok: false; code: string; message: string; details?: unknown };

/** Failures after which main still has the text (as a recovered draft) or the note is gone (D-055). */
const KEPT_AFTER_FAILURE = new Set(['CONFLICT', 'NOT_FOUND']);

/** True when nothing typed would be lost by closing the view now: saved, or kept by main as a draft (D-055, D-072). */
export function textIsSafe(result: FlushResult): boolean {
  return result.ok || KEPT_AFTER_FAILURE.has(result.code);
}
export type ActionResult = { ok: true } | { ok: false; message: string };

export const SAVE_DEBOUNCE_MS = 400;
export const SAVE_FAILED = 'Could not save this note.';
export const CONTENT_ERROR = 'This note could not be displayed.';
/** Pushes in a row before a view waits for the next edit (others keep pushing ahead of it). */
const MAX_PUSH_ROUNDS = 20;

export interface NoteControllerDeps {
  bridge: InfinityBridge;
  noteId: string;
  viewId: string;
  timers: Timers;
  uuid: () => string;
}

const draftIdOf = (error: ErrorEnvelope): string | null => {
  const id = (error.details as { draftId?: unknown } | undefined)?.draftId;
  return typeof id === 'string' ? id : null;
};

/**
 * One open note in one view (plan section 10.1, D-103): opening, live sync with every other view of the note through
 * main, acknowledged saves, conflict recovery, format conversion and version and draft restores. Every view edits at
 * once: this view sends its editing steps to main, which orders them, saves the document and sends every confirmed
 * step back to all views. Nothing typed is ever dropped without main keeping it (D-055).
 */
export class NoteController implements EditorHost {
  readonly noteId: string;
  readonly store: Store<NoteControllerState>;
  private source: ContentSource | null = null;
  /** The live-sync session this view joined; empty until it joined. */
  private epoch = '';
  private pushing: Promise<void> | null = null;
  private pushAgain = false;
  private renaming: Promise<void> | null = null;
  private pendingTitle: string | null = null;
  private failure: { code: string; message: string; details?: unknown } | null = null;
  private disposed = false;
  private readonly renameTimer;

  constructor(private readonly deps: NoteControllerDeps) {
    this.noteId = deps.noteId;
    this.store = createStore<NoteControllerState>({
      status: 'loading',
      note: null,
      title: '',
      format: 'rich',
      revision: 0,
      content: null,
      syncVersion: 0,
      contentKey: 0,
      save: 'saved',
      drafts: [],
      conflict: null,
      converted: null,
      busy: null,
      cursorBlockId: null,
      reveal: null,
    });
    this.renameTimer = createDebouncer(deps.timers, SAVE_DEBOUNCE_MS, () => void this.runRename());
  }

  /** The id this view's steps carry (prosemirror-collab client id). */
  get viewId(): string {
    return this.deps.viewId;
  }

  private get state(): NoteControllerState {
    return this.store.getState();
  }

  private get view() {
    return { noteId: this.noteId, viewId: this.deps.viewId };
  }

  // Opening ----------------------------------------------------------------------------
  /** Opens the note and joins its live-sync session. */
  async open(): Promise<void> {
    const res = await this.deps.bridge.note.open({ noteId: this.noteId });
    if (this.disposed) return;
    if (!res.ok) {
      this.applyOpenFailure(res.error);
      return;
    }
    const drafts = await this.deps.bridge.drafts.list({ noteId: this.noteId });
    this.store.setState({ note: res.data.note, title: res.data.note.title, drafts: drafts.ok ? drafts.data.drafts : [] });
    await this.join();
  }

  private async join(): Promise<boolean> {
    const res = await this.deps.bridge.collab.join(this.view);
    if (this.disposed) {
      if (res.ok) void this.deps.bridge.collab.leave(this.view);
      return false;
    }
    if (!res.ok) {
      this.applyOpenFailure(res.error);
      return false;
    }
    this.applySnapshot(res.data);
    return true;
  }

  /** The editor starts over from a snapshot of a new session; a snapshot of the session it is in changes nothing. */
  private applySnapshot(snap: CollabSnapshotType): void {
    if (snap.epoch === this.epoch && this.state.status === 'ready') return;
    this.epoch = snap.epoch;
    this.failure = null;
    this.store.setState((s) => ({
      ...s,
      status: 'ready',
      message: undefined,
      format: snap.format,
      revision: snap.revision,
      content: snap.doc,
      syncVersion: snap.version,
      contentKey: s.contentKey + 1,
      save: 'saved',
    }));
  }

  private applyOpenFailure(error: ErrorEnvelope): void {
    this.epoch = '';
    const details = error.details as { trashed?: boolean; trashBatchId?: string | null; locked?: boolean } | undefined;
    if (error.code === 'FORBIDDEN' && details?.locked) this.store.setState({ status: 'locked', message: undefined, content: null, save: 'saved' });
    else if (error.code === 'NOT_FOUND' && details?.trashed) this.store.setState({ status: 'trashed', trashBatchId: details.trashBatchId ?? null, message: error.message });
    else if (error.code === 'NOT_FOUND') this.store.setState({ status: 'missing', message: error.message });
    else this.store.setState({ status: 'error', message: error.message });
  }

  private async refreshDrafts(): Promise<void> {
    const res = await this.deps.bridge.drafts.list({ noteId: this.noteId });
    if (res.ok && !this.disposed) this.store.setState({ drafts: res.data.drafts });
  }

  // Editor host ----------------------------------------------------------------------------
  attachSource(source: ContentSource): void {
    this.source = source;
  }

  detachSource(source: ContentSource): void {
    if (this.source === source) this.source = null;
  }

  markDirty(): void {
    if (this.state.status !== 'ready') return;
    this.failure = null;
    this.store.setState({ save: this.state.save === 'retrying' ? 'retrying' : 'pending' });
    this.schedulePush();
  }

  setCursorBlock(blockId: string | null): void {
    if (this.state.cursorBlockId !== blockId) this.store.setState({ cursorBlockId: blockId });
  }

  /** The text of a block in the editor (a reminder's title), or null when the editor does not show it. */
  blockText(blockId: string): string | null {
    return this.source?.blockText(blockId) ?? null;
  }

  /** The text a reminder source is read in (see ContentSource.phraseText), or null when the editor does not show it. */
  phraseText(blockId: string | null): string | null {
    return this.source?.phraseText(blockId) ?? null;
  }

  /** Asks the editor to reveal a block: select its start, scroll it into view and highlight it briefly. */
  requestReveal(blockId: string): void {
    this.store.setState((s) => ({ ...s, reveal: { blockId, nonce: (s.reveal?.nonce ?? 0) + 1 } }));
  }

  revealDone(): void {
    if (this.state.reveal) this.store.setState({ reveal: null });
  }

  /**
   * Saves the document as it is, block IDs main gave it when the note opened included, so a reminder can anchor to
   * them (D-080). False when the note is not open or the save failed.
   */
  async persistBlockIds(): Promise<boolean> {
    if (this.state.status !== 'ready' || !this.source) return false;
    return (await this.flush({ force: true })).ok;
  }

  contentError(): void {
    this.store.setState({ status: 'error', message: CONTENT_ERROR });
    void this.leave();
  }

  // Live sync ----------------------------------------------------------------------------
  /** Sends this view's steps, one request at a time; edits made meanwhile are sent right after. */
  private schedulePush(): Promise<void> {
    if (this.pushing) {
      this.pushAgain = true;
      return this.pushing;
    }
    this.pushing = (async () => {
      try {
        do {
          this.pushAgain = false;
          await this.pushRounds();
        } while (this.pushAgain && !this.disposed);
      } finally {
        this.pushing = null;
      }
    })();
    return this.pushing;
  }

  private async pushRounds(): Promise<void> {
    for (let round = 0; round < MAX_PUSH_ROUNDS; round += 1) {
      const sendable = this.source?.sendable();
      if (!sendable || this.disposed || this.state.status !== 'ready' || this.failure) return;
      const res = await this.deps.bridge.collab.push({ ...this.view, epoch: this.epoch, ...sendable });
      if (!res.ok) {
        // The steps stay unconfirmed and go with the next edit or flush (a note too large, for example).
        this.failure = { code: res.error.code, message: res.error.message };
        this.store.setState({ save: 'error', message: res.error.code === 'VALIDATION_FAILED' ? SAVE_FAILED : res.error.message });
        return;
      }
      if (res.data.status === 'reset') {
        await this.restart(null);
        return;
      }
      // Behind: other views' steps came first. Accepted: this view's own come back and confirm them.
      if (this.source && this.source.version() < res.data.version && !(await this.pull())) return;
      if (res.data.status === 'accepted' && !this.source?.sendable()) this.markConfirmed();
    }
  }

  /** Fetches the confirmed steps this view has not received; false when the session started over instead. */
  private async pull(): Promise<boolean> {
    if (!this.source) return false;
    const res = await this.deps.bridge.collab.pull({ ...this.view, epoch: this.epoch, version: this.source.version() });
    if (!res.ok || this.disposed || !this.source) return false;
    if (res.data.status === 'reset') {
      await this.restart(null);
      return false;
    }
    this.source.receive(res.data.version, res.data.steps, res.data.clientIDs);
    return true;
  }

  private markConfirmed(): void {
    if (this.state.save === 'pending') this.store.setState({ save: 'saving' });
  }

  /** Confirmed steps of the note's views: this view applies them and sends its own again on top. */
  onSteps(event: CollabStepsEventType): void {
    if (event.noteId !== this.noteId || event.epoch !== this.epoch || this.disposed || !this.source) return;
    if (this.source.receive(event.version, event.steps, event.clientIDs) === 'gap') {
      void this.pull();
      return;
    }
    if (this.source.sendable()) void this.schedulePush();
    else this.markConfirmed();
  }

  /** Main saved (or could not save) the note: the indicator shows whether this view's text is stored. */
  onStatus(event: CollabStatusEventType): void {
    if (event.noteId !== this.noteId || event.epoch !== this.epoch || this.disposed) return;
    if (event.state === 'saved') {
      const mine = this.source?.sendable() ? Number.POSITIVE_INFINITY : (this.source?.version() ?? 0);
      this.store.setState({ revision: event.revision, ...(mine <= event.savedVersion ? { save: 'saved' as const, message: undefined } : {}) });
      if (mine <= event.savedVersion) this.failure = null;
    } else {
      this.store.setState({ save: event.state, message: event.message ?? SAVE_FAILED });
    }
  }

  /** The note was replaced from outside the session: join it again, keeping a draft of anything not synced. */
  onReset(event: CollabResetEventType): void {
    // A content operation of this view joins the new session itself when it is done.
    if (event.noteId !== this.noteId || this.disposed || this.state.status !== 'ready' || this.state.busy !== null) return;
    void this.restart(event.conflict?.reason === 'stale' ? { draftId: event.conflict.draftId, reason: 'stale' } : null);
  }

  /**
   * Joins the session again. Steps of this view main never confirmed were made on the old text: they are kept as a
   * recovered draft (a whole-content save on the old revision, which main stores as a conflict draft).
   */
  private async restart(conflict: { draftId: string; reason: 'stale' } | null): Promise<void> {
    let kept = conflict;
    if (this.source?.sendable()) {
      const res = await this.deps.bridge.note.save({
        ...this.view,
        baseRevision: this.state.revision,
        requestId: this.deps.uuid(),
        format: this.state.format,
        content: this.source.getContent(),
      });
      const draftId = res.ok ? null : draftIdOf(res.error);
      if (draftId) kept = { draftId, reason: 'stale' };
    }
    if (!(await this.join())) return;
    if (kept) this.store.setState({ conflict: kept });
    await this.refreshDrafts();
  }

  /** Sends every unconfirmed step and waits for main to confirm them (or to refuse them). */
  private async pushAll(): Promise<void> {
    for (let i = 0; i < MAX_PUSH_ROUNDS && this.source?.sendable() && !this.failure && this.state.status === 'ready'; i += 1) {
      await this.schedulePush();
    }
  }

  /**
   * Sends everything pending (waiting up to 10 s for image imports), has main save the note and resolves with the
   * outcome. `force` also saves block IDs main gave the note when it opened.
   */
  async flush(opts: { force?: boolean } = {}): Promise<FlushResult> {
    if (this.source?.hasPendingUploads()) await this.source.waitForUploads(IMPORT_WAIT_ON_FLUSH_MS);
    this.renameTimer.cancel();
    if (this.state.status === 'ready' && this.epoch) {
      this.failure = null;
      await this.pushAll();
      if (!this.failure) await this.saveInMain(opts.force === true);
    }
    if (this.pendingTitle !== null || this.renaming) await this.runRename();
    if (this.failure) return { ok: false, ...this.failure };
    return { ok: true };
  }

  private async saveInMain(force: boolean): Promise<void> {
    const res = await this.deps.bridge.collab.flush({ ...this.view, ...(force ? { force } : {}) });
    if (this.disposed) return;
    if (!res.ok) {
      this.failure = { code: res.error.code, message: res.error.message, details: res.error.details };
      if (res.error.code !== 'CONFLICT') this.store.setState({ save: 'error', message: res.error.message });
      return;
    }
    this.store.setState({ revision: res.data.revision, ...(this.source?.sendable() ? {} : { save: 'saved' as const, message: undefined }) });
  }

  private async leave(): Promise<void> {
    if (!this.epoch) return;
    this.epoch = '';
    await this.deps.bridge.collab.leave(this.view);
  }

  // Title ----------------------------------------------------------------------------
  rename(title: string): void {
    const state = this.state;
    if (state.status === 'trashed' || state.status === 'missing') return;
    const clean = normalizeTitle(title);
    const error = validateTitle(clean);
    this.store.setState({ title, titleError: error ?? undefined });
    if (error) {
      this.renameTimer.cancel();
      this.pendingTitle = null;
      return;
    }
    this.pendingTitle = clean;
    this.renameTimer.schedule();
  }

  private async runRename(): Promise<void> {
    if (this.renaming) await this.renaming;
    if (this.pendingTitle === null) return;
    const title = this.pendingTitle;
    this.pendingTitle = null;
    this.renaming = (async () => {
      const res = await this.deps.bridge.note.rename({ noteId: this.noteId, title });
      if (!res.ok) {
        this.failure = { code: res.error.code, message: res.error.message };
        this.store.setState({ titleError: res.error.message });
      } else if (!this.disposed) {
        this.store.setState((s) => ({ ...s, note: s.note ? { ...s.note, title: res.data.note.title } : s.note }));
      }
    })();
    try {
      await this.renaming;
    } finally {
      this.renaming = null;
    }
    if (this.pendingTitle !== null) await this.runRename();
  }

  // User actions ----------------------------------------------------------------------------
  private async busyWith<T>(busy: Busy, fn: () => Promise<T>): Promise<T> {
    this.store.setState({ busy });
    try {
      return await fn();
    } finally {
      if (!this.disposed) this.store.setState({ busy: null });
    }
  }

  /**
   * The note went to Trash elsewhere: pending edits are flushed (main keeps them as a trashed-conflict draft), the
   * view leaves the session and shows the trash state. The flush result tells whether a draft was kept.
   */
  async handleTrashed(batchId: string | null): Promise<FlushResult> {
    const flushed = await this.flush();
    await this.leave();
    if (!this.disposed) this.store.setState({ status: 'trashed', trashBatchId: batchId, save: 'saved' });
    return flushed;
  }

  /**
   * The view stops showing the note (its locked sticky blurred, D-172): it leaves live sync and drops the text and its
   * drafts, so nothing of it stays in the window. Main saved the session's edits before it blurred the sticky.
   */
  async conceal(): Promise<void> {
    await this.leave();
    if (!this.disposed) this.store.setState({ status: 'locked', content: null, drafts: [], conflict: null, save: 'saved', message: undefined });
  }

  /** The note is back from Trash: open it again from the stored content. */
  async reopen(): Promise<void> {
    this.failure = null;
    this.store.setState({ status: 'loading', message: undefined, trashBatchId: undefined, conflict: null });
    await this.open();
  }

  /**
   * Runs a content operation (conversion, restores): the editor stays read-only while it runs, the edits of every view
   * are saved first, and afterwards the view joins the session the new content started.
   */
  private contentOp(busy: Busy, call: (op: { noteId: string; viewId: string; baseRevision: number; requestId: string }) => Promise<ActionResult>): Promise<ActionResult> {
    return this.busyWith(busy, async () => {
      const flushed = await this.flush();
      // A failure blocks only while edits are still unsynced; edits main refused were kept as a draft.
      if (!flushed.ok && this.source?.sendable()) return { ok: false, message: flushed.message };
      const result = await call({ ...this.view, baseRevision: this.state.revision, requestId: this.deps.uuid() });
      if (result.ok) await this.join();
      return result;
    });
  }

  /** Converts after a successful flush; rich to plain keeps the formatted version for "Restore formatted version". */
  convert(target: 'rich' | 'plain'): Promise<ActionResult> {
    return this.contentOp('convert', async (op) => {
      const res = await this.deps.bridge.note.convertFormat({ ...op, targetFormat: target, ...(target === 'plain' ? { confirmLossy: true as const } : {}) });
      if (!res.ok) return { ok: false, message: res.error.message };
      this.store.setState({ converted: target === 'plain' && res.data.versionId ? { versionId: res.data.versionId } : null });
      return { ok: true };
    });
  }

  async listVersions(): Promise<Result<{ versions: VersionSummaryType[] }>> {
    return this.deps.bridge.versions.list({ noteId: this.noteId });
  }

  restoreVersion(versionId: string): Promise<ActionResult> {
    return this.contentOp('restore', async (op) => {
      const res = await this.deps.bridge.versions.restore({ ...op, versionId });
      if (!res.ok) return { ok: false, message: res.error.message };
      this.store.setState({ converted: null });
      return { ok: true };
    });
  }

  restoreDraft(draftId: string): Promise<ActionResult> {
    return this.contentOp('draft', async (op) => {
      const res = await this.deps.bridge.drafts.resolve({ action: 'restore', ...op, draftId });
      if (!res.ok) return { ok: false, message: res.error.message };
      this.store.setState({ conflict: null });
      await this.refreshDrafts();
      return { ok: true };
    });
  }

  dismissDraft(draftId: string): Promise<ActionResult> {
    return this.busyWith('draft', async () => {
      const res = await this.deps.bridge.drafts.resolve({ action: 'dismiss', noteId: this.noteId, draftId });
      if (!res.ok) return { ok: false, message: res.error.message };
      this.store.setState({ conflict: null });
      await this.refreshDrafts();
      return { ok: true };
    });
  }

  dismissConverted(): void {
    this.store.setState({ converted: null });
  }

  /** The visible text of the editor, for the Compare dialog. */
  currentText(): string {
    return this.source?.getPlainText() ?? '';
  }

  async dispose(opts: { flush?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    if (opts.flush !== false) await this.flush();
    this.disposed = true;
    this.renameTimer.cancel();
    await this.leave();
  }
}
