import { IMPORT_WAIT_ON_FLUSH_MS } from '../../shared/attachments/limits';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { ErrorEnvelope, Result } from '../../shared/contracts/envelope';
import type { NoteSummaryType } from '../../shared/contracts/hierarchy';
import { SAVE_RETRIES, SAVE_RETRY_DELAY_MS, type DraftSummaryType, type NoteContentResponseType, type VersionSummaryType } from '../../shared/contracts/notes';
import type { RichDocLike } from '../../shared/editor/doc-schema';
import { validateTitle, normalizeTitle } from '../../shared/names';
import type { ContentSource, EditorHost } from '../editor/content';
import { createDebouncer, createStore, type Store, type Timers } from '../state/store';

export type NoteStatus = 'loading' | 'ready' | 'readOnly' | 'trashed' | 'missing' | 'error';
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'retrying' | 'error';
export type Busy = 'take' | 'convert' | 'restore' | 'draft' | null;

export interface NoteControllerState {
  status: NoteStatus;
  note: NoteSummaryType | null;
  title: string;
  format: 'rich' | 'plain';
  revision: number;
  /** The content the editor is created from; replaced (with a new contentKey) on reloads and restores. */
  content: RichDocLike | string | null;
  contentKey: number;
  save: SaveStatus;
  message?: string;
  titleError?: string;
  trashBatchId?: string | null;
  /** Why the note is read-only: another view holds the lease, or this view lost it to another window. */
  readOnlyReason: 'lease' | 'leaseLost' | null;
  holderElsewhere: boolean;
  drafts: DraftSummaryType[];
  /** The draft main stored when a save of this view was refused. */
  conflict: { draftId: string; reason: 'stale' | 'lease_lost' } | null;
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
const KEPT_AFTER_FAILURE = new Set(['CONFLICT', 'LEASE_REQUIRED', 'NOT_FOUND']);

/** True when nothing typed would be lost by closing the view now: saved, or kept by main as a draft (D-055, D-072). */
export function textIsSafe(result: FlushResult): boolean {
  return result.ok || KEPT_AFTER_FAILURE.has(result.code);
}
export type ActionResult = { ok: true } | { ok: false; message: string };

export const SAVE_DEBOUNCE_MS = 400;
export const RETRY_DELAY_MS = SAVE_RETRY_DELAY_MS;
export const MAX_RETRIES = SAVE_RETRIES;
export const SAVE_FAILED = 'Could not save this note.';
export const CONTENT_ERROR = 'This note could not be displayed.';
export const TAKE_CONTROL_FIRST = 'Take edit control first';

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
 * One open note in one view (plan section 10.1): opening, the editing lease, debounced acknowledged saves,
 * conflict and lease recovery, format conversion and version and draft restores. The editor supplies content
 * through a ContentSource; nothing typed is ever dropped without main keeping it (D-055).
 */
export class NoteController implements EditorHost {
  readonly noteId: string;
  readonly store: Store<NoteControllerState>;
  private leaseToken: string | null = null;
  private source: ContentSource | null = null;
  private dirty = false;
  private saving: Promise<void> | null = null;
  private renaming: Promise<void> | null = null;
  private pendingTitle: string | null = null;
  private failure: { code: string; message: string; details?: unknown } | null = null;
  private opening: Promise<void> | null = null;
  private disposed = false;
  private readonly saveTimer;
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
      contentKey: 0,
      save: 'saved',
      readOnlyReason: null,
      holderElsewhere: false,
      drafts: [],
      conflict: null,
      converted: null,
      busy: null,
      cursorBlockId: null,
      reveal: null,
    });
    this.saveTimer = createDebouncer(deps.timers, SAVE_DEBOUNCE_MS, () => void this.drain());
    this.renameTimer = createDebouncer(deps.timers, SAVE_DEBOUNCE_MS, () => void this.runRename());
  }

  private get state(): NoteControllerState {
    return this.store.getState();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.deps.timers.setTimeout(resolve, ms));
  }

  /** The fields of every content-changing request (plan section 10.1). */
  private op(leaseToken: string) {
    return { noteId: this.noteId, viewId: this.deps.viewId, leaseToken, baseRevision: this.state.revision, requestId: this.deps.uuid() };
  }

  // Opening ----------------------------------------------------------------------------
  /**
   * Opens the note and asks for the lease. With `take`, a lease held elsewhere is taken (Float and Dock are explicit
   * requests for edit control, D-065).
   */
  open(mode: 'acquire' | 'take' = 'acquire'): Promise<void> {
    this.opening = (async () => {
      await this.load();
      if (mode === 'take' && this.state.status === 'readOnly') await this.takeEditControl();
    })();
    return this.opening;
  }

  private async load(): Promise<void> {
    const res = await this.deps.bridge.note.open({ noteId: this.noteId });
    if (this.disposed) return;
    if (!res.ok) {
      this.applyOpenFailure(res.error);
      return;
    }
    const d = res.data;
    const drafts = await this.deps.bridge.drafts.list({ noteId: this.noteId });
    const lease = await this.deps.bridge.lease.acquire({ noteId: this.noteId, viewId: this.deps.viewId });
    if (this.disposed) {
      if (lease.ok && lease.data.granted) void this.deps.bridge.lease.release({ noteId: this.noteId, viewId: this.deps.viewId, leaseToken: lease.data.leaseToken });
      return;
    }
    const base = {
      note: d.note,
      title: d.note.title,
      format: d.format,
      revision: d.revision,
      content: d.content as RichDocLike | string,
      contentKey: this.state.contentKey + 1,
      save: 'saved' as const,
      drafts: drafts.ok ? drafts.data.drafts : [],
    };
    if (!lease.ok) {
      this.store.setState({ ...base, status: 'error', message: lease.error.message });
    } else if (lease.data.granted) {
      this.leaseToken = lease.data.leaseToken;
      this.store.setState({ ...base, status: 'ready', readOnlyReason: null, holderElsewhere: false });
    } else {
      this.store.setState({ ...base, status: 'readOnly', readOnlyReason: 'lease', holderElsewhere: true });
    }
  }

  private applyOpenFailure(error: ErrorEnvelope): void {
    const details = error.details as { trashed?: boolean; trashBatchId?: string | null } | undefined;
    if (error.code === 'NOT_FOUND' && details?.trashed) this.store.setState({ status: 'trashed', trashBatchId: details.trashBatchId ?? null, message: error.message });
    else if (error.code === 'NOT_FOUND') this.store.setState({ status: 'missing', message: error.message });
    else this.store.setState({ status: 'error', message: error.message });
  }

  /** Replaces the content with the stored one (new editor instance, clean undo history). */
  async reload(): Promise<void> {
    const res = await this.deps.bridge.note.open({ noteId: this.noteId });
    if (this.disposed) return;
    if (!res.ok) {
      this.applyOpenFailure(res.error);
      return;
    }
    this.dirty = false;
    this.store.setState((s) => ({
      ...s,
      note: res.data.note,
      format: res.data.format,
      revision: res.data.revision,
      content: res.data.content as RichDocLike | string,
      contentKey: s.contentKey + 1,
    }));
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
    if (this.state.status !== 'ready' || this.leaseToken === null) return;
    this.dirty = true;
    this.failure = null;
    this.store.setState({ save: this.state.save === 'retrying' ? 'retrying' : 'pending' });
    this.saveTimer.schedule();
  }

  setCursorBlock(blockId: string | null): void {
    if (this.state.cursorBlockId !== blockId) this.store.setState({ cursorBlockId: blockId });
  }

  /** The text of a block in the editor (a reminder's title), or null when the editor does not show it. */
  blockText(blockId: string): string | null {
    return this.source?.blockText(blockId) ?? null;
  }

  /** Asks the editor to reveal a block: select its start, scroll it into view and highlight it briefly. */
  requestReveal(blockId: string): void {
    this.store.setState((s) => ({ ...s, reveal: { blockId, nonce: (s.reveal?.nonce ?? 0) + 1 } }));
  }

  revealDone(): void {
    if (this.state.reveal) this.store.setState({ reveal: null });
  }

  /**
   * Saves the editor's content as it is, so block IDs assigned when the note opened are stored and a reminder can
   * anchor to them (D-080). False when this view cannot save (read-only) or the save failed.
   */
  async persistBlockIds(): Promise<boolean> {
    if (this.state.status !== 'ready' || this.leaseToken === null || !this.source) return false;
    this.markDirty();
    return (await this.flush()).ok;
  }

  contentError(): void {
    this.dirty = false;
    this.store.setState({ status: 'error', message: CONTENT_ERROR });
    void this.releaseLease();
  }

  // Saving ----------------------------------------------------------------------------
  /** Sends the current content, one request at a time; edits made during a save cause one follow-up save. */
  private drain(): Promise<void> {
    if (this.saving) return this.saving;
    this.saving = (async () => {
      try {
        while (this.dirty && !this.disposed && this.source && this.state.status === 'ready' && this.leaseToken !== null) {
          this.dirty = false;
          if (!(await this.saveOnce(this.leaseToken, this.source.getContent()))) return;
        }
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  /** One save with INTERNAL retries (same requestId). Returns false when the loop must stop. */
  private async saveOnce(leaseToken: string, content: RichDocLike | string): Promise<boolean> {
    const req = { ...this.op(leaseToken), format: this.state.format, content };
    this.store.setState({ save: 'saving' });
    for (let attempt = 0; ; attempt += 1) {
      const res = await this.deps.bridge.note.save(req);
      if (res.ok) {
        this.failure = null;
        this.store.setState({ revision: res.data.revision, save: this.dirty ? 'saving' : 'saved' });
        return true;
      }
      if (res.error.code === 'INTERNAL' && attempt < MAX_RETRIES) {
        this.store.setState({ save: 'retrying' });
        await this.sleep(RETRY_DELAY_MS);
        continue;
      }
      await this.handleSaveFailure(res.error, req);
      return false;
    }
  }

  private async handleSaveFailure(error: ErrorEnvelope, refused: { leaseToken: string; baseRevision: number }): Promise<void> {
    this.failure = { code: error.code, message: error.message, details: error.details };
    if (error.code === 'CONFLICT' || error.code === 'LEASE_REQUIRED') {
      let draftId = draftIdOf(error);
      // Text typed while the refused save was in flight is submitted once more, so main keeps it as a draft too.
      if (this.dirty && this.source) {
        this.dirty = false;
        const again = await this.deps.bridge.note.save({ ...this.op(refused.leaseToken), baseRevision: refused.baseRevision, format: this.state.format, content: this.source.getContent() });
        if (!again.ok) draftId = draftIdOf(again.error) ?? draftId;
      }
      const trashed = (error.details as { reason?: string } | undefined)?.reason === 'trashed';
      if (trashed) {
        this.store.setState({ status: 'trashed', save: 'saved', message: error.message });
        return;
      }
      await this.reload();
      if (error.code === 'LEASE_REQUIRED') {
        this.leaseToken = null;
        this.store.setState({ status: 'readOnly', readOnlyReason: 'leaseLost', save: 'saved', conflict: draftId ? { draftId, reason: 'lease_lost' } : null });
      } else {
        this.store.setState({ save: 'saved', conflict: draftId ? { draftId, reason: 'stale' } : null });
      }
      await this.refreshDrafts();
      return;
    }
    if (error.code === 'NOT_FOUND') {
      this.store.setState({ status: 'missing', save: 'error', message: error.message });
      return;
    }
    // The content stays dirty: the next edit (or flush) tries again; nothing is dropped.
    this.dirty = true;
    if (error.code === 'VALIDATION_FAILED') {
      console.error(`note ${this.noteId}: save refused: ${error.message}`);
      this.store.setState({ save: 'error', message: SAVE_FAILED });
    } else {
      this.store.setState({ save: 'error', message: error.message });
    }
  }

  /** Sends everything pending (waiting up to 10 s for image imports) and resolves after the ack or failure. */
  async flush(): Promise<FlushResult> {
    if (this.source?.hasPendingUploads()) await this.source.waitForUploads(IMPORT_WAIT_ON_FLUSH_MS);
    this.saveTimer.cancel();
    this.renameTimer.cancel();
    if (this.dirty) await this.drain();
    else if (this.saving) await this.saving;
    if (this.pendingTitle !== null || this.renaming) await this.runRename();
    if (this.failure) return { ok: false, ...this.failure };
    return { ok: true };
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

  // Events from main ----------------------------------------------------------------------------
  /** Another view saved: read-only mirrors and idle editors show the new content. */
  onRevision(event: { noteId: string; revision: number; sourceViewId: string }): void {
    if (event.noteId !== this.noteId || event.sourceViewId === this.deps.viewId || this.disposed) return;
    const { status } = this.state;
    if (status === 'readOnly' || (status === 'ready' && !this.dirty && !this.saving && this.state.save === 'saved')) void this.reload();
  }

  /**
   * Tracks the holder. A mirror that is read-only only because another view held the lease acquires it as soon as
   * the note is free (D-065); a mirror that lost its lease keeps the recovered-draft banner, and a take in flight
   * (busy) never races its own acquire.
   */
  onLease(event: { noteId: string; holderViewId: string | null }): void {
    if (event.noteId !== this.noteId || this.disposed) return;
    if (event.holderViewId === this.deps.viewId) return;
    this.store.setState({ holderElsewhere: event.holderViewId !== null });
    const { status, readOnlyReason, busy } = this.state;
    if (event.holderViewId === null && status === 'readOnly' && readOnlyReason === 'lease' && busy === null) void this.autoAcquire();
  }

  private autoAcquire(): Promise<void> {
    return this.busyWith('take', async () => {
      const res = await this.deps.bridge.lease.acquire({ noteId: this.noteId, viewId: this.deps.viewId });
      if (!res.ok || !res.data.granted || this.disposed) return;
      this.leaseToken = res.data.leaseToken;
      if (this.state.status !== 'readOnly' || this.state.readOnlyReason !== 'lease') {
        await this.releaseLease();
        return;
      }
      await this.reload();
      this.store.setState({ status: 'ready', readOnlyReason: null, holderElsewhere: false });
    });
  }

  /** Another window takes edit control: flush, release, and become a read-only mirror. */
  async onReleaseRequest(): Promise<void> {
    if (this.disposed) return;
    await this.flush();
    await this.releaseLease();
    this.store.setState({ status: this.state.status === 'ready' ? 'readOnly' : this.state.status, readOnlyReason: 'lease', holderElsewhere: true });
  }

  private async releaseLease(): Promise<void> {
    const token = this.leaseToken;
    this.leaseToken = null;
    if (token) await this.deps.bridge.lease.release({ noteId: this.noteId, viewId: this.deps.viewId, leaseToken: token });
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

  /** Takes the lease from the holder (which flushes first) or a free note, then shows the stored content. */
  takeEditControl(): Promise<ActionResult> {
    return this.busyWith('take', async () => {
      const res = await this.deps.bridge.lease.take({ noteId: this.noteId, viewId: this.deps.viewId });
      if (!res.ok) return { ok: false, message: res.error.message };
      this.leaseToken = res.data.leaseToken;
      await this.reload();
      this.store.setState((s) => ({
        ...s,
        status: 'ready',
        readOnlyReason: null,
        holderElsewhere: false,
        conflict: s.conflict?.reason === 'lease_lost' ? null : s.conflict,
      }));
      return { ok: true };
    });
  }

  /** Takes edit control unless this view already has it or is busy (Float or Dock of an open note). */
  async ensureEditing(): Promise<ActionResult> {
    await this.opening;
    if (this.disposed || this.state.status !== 'readOnly' || this.state.busy !== null) return { ok: true };
    return this.takeEditControl();
  }

  /**
   * The note went to Trash elsewhere: pending edits are flushed (main keeps them as a trashed-conflict draft), the
   * lease is released and the view shows the trash state. The flush result tells whether a draft was kept.
   */
  async handleTrashed(batchId: string | null): Promise<FlushResult> {
    const flushed = await this.flush();
    await this.releaseLease();
    if (!this.disposed) this.store.setState({ status: 'trashed', trashBatchId: batchId, save: 'saved' });
    return flushed;
  }

  /** The note is back from Trash: open it again from the stored content. */
  async reopen(): Promise<void> {
    this.dirty = false;
    this.failure = null;
    this.store.setState({ status: 'loading', message: undefined, trashBatchId: undefined, readOnlyReason: null, holderElsewhere: false, conflict: null });
    await this.open('acquire');
  }

  private applyContent(res: NoteContentResponseType): void {
    this.dirty = false;
    this.store.setState((s) => ({ ...s, format: res.format, content: res.content as RichDocLike | string, revision: res.revision, contentKey: s.contentKey + 1, save: 'saved' }));
  }

  /**
   * Runs a content operation that needs edit control: flushes first, then calls main with the lease and base
   * revision. Read-only views get "Take edit control first".
   */
  private contentOp(busy: Busy, call: (op: ReturnType<NoteController['op']>) => Promise<ActionResult>): Promise<ActionResult> {
    return this.busyWith(busy, async () => {
      const flushed = await this.flush();
      // A failure blocks only while edits are still unsaved; edits main refused were kept as a draft.
      if (!flushed.ok && this.dirty) return { ok: false, message: flushed.message };
      if (this.leaseToken === null) return { ok: false, message: TAKE_CONTROL_FIRST };
      return call(this.op(this.leaseToken));
    });
  }

  /** Converts after a successful flush; rich to plain keeps the formatted version for "Restore formatted version". */
  convert(target: 'rich' | 'plain'): Promise<ActionResult> {
    return this.contentOp('convert', async (op) => {
      const res = await this.deps.bridge.note.convertFormat({ ...op, targetFormat: target, ...(target === 'plain' ? { confirmLossy: true as const } : {}) });
      if (!res.ok) return { ok: false, message: res.error.message };
      this.applyContent(res.data);
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
      this.applyContent(res.data);
      this.store.setState({ converted: null });
      return { ok: true };
    });
  }

  restoreDraft(draftId: string): Promise<ActionResult> {
    return this.contentOp('draft', async (op) => {
      const res = await this.deps.bridge.drafts.resolve({ action: 'restore', ...op, draftId });
      if (!res.ok) return { ok: false, message: res.error.message };
      if (res.data.content) this.applyContent(res.data.content);
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
    this.saveTimer.cancel();
    this.renameTimer.cancel();
    await this.releaseLease();
  }
}
