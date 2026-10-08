import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { NoteSummaryType } from '../../shared/contracts/hierarchy';
import { validateTitle, normalizeTitle } from '../../shared/names';
import { docToText, isTextareaCompatible, textToDoc } from '../../shared/text/textarea-doc';
import { createDebouncer, createStore, type Store, type Timers } from '../state/store';

export type NoteStatus = 'loading' | 'ready' | 'readOnly' | 'trashed' | 'missing' | 'error';
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'retrying' | 'error';

export interface NoteControllerState {
  status: NoteStatus;
  note: NoteSummaryType | null;
  title: string;
  text: string;
  revision: number;
  save: SaveStatus;
  message?: string;
  titleError?: string;
  trashBatchId?: string | null;
}

export type FlushResult = { ok: true } | { ok: false; code: string; message: string };

export const SAVE_DEBOUNCE_MS = 400;
export const RETRY_DELAY_MS = 1000;
export const MAX_RETRIES = 3;
export const READONLY_ELSEWHERE = 'This note is being edited in another window';
export const READONLY_CHANGED = 'This note changed elsewhere. Your edits were kept as a recovered draft';
export const READONLY_FORMAT = 'This note uses formatting that this editor cannot show yet. It is read-only.';

export interface NoteControllerDeps {
  bridge: InfinityBridge;
  noteId: string;
  viewId: string;
  timers: Timers;
  uuid: () => string;
}

export class NoteController {
  readonly noteId: string;
  readonly store: Store<NoteControllerState>;
  private format: 'rich' | 'plain' = 'rich';
  private leaseToken: string | null = null;
  private dirtyText = false;
  private saving: Promise<void> | null = null;
  private renaming: Promise<void> | null = null;
  private pendingTitle: string | null = null;
  private failure: { code: string; message: string } | null = null;
  private disposed = false;
  private readonly saveTimer;
  private readonly renameTimer;

  constructor(private readonly deps: NoteControllerDeps) {
    this.noteId = deps.noteId;
    this.store = createStore<NoteControllerState>({ status: 'loading', note: null, title: '', text: '', revision: 0, save: 'saved' });
    this.saveTimer = createDebouncer(deps.timers, SAVE_DEBOUNCE_MS, () => void this.drain());
    this.renameTimer = createDebouncer(deps.timers, SAVE_DEBOUNCE_MS, () => void this.runRename());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.deps.timers.setTimeout(resolve, ms));
  }

  async open(): Promise<void> {
    const res = await this.deps.bridge.note.open({ noteId: this.noteId });
    if (this.disposed) return;
    if (!res.ok) {
      const details = res.error.details as { trashed?: boolean; trashBatchId?: string | null } | undefined;
      if (res.error.code === 'NOT_FOUND' && details?.trashed) {
        this.store.setState({ status: 'trashed', trashBatchId: details.trashBatchId ?? null, message: res.error.message });
      } else if (res.error.code === 'NOT_FOUND') {
        this.store.setState({ status: 'missing', message: res.error.message });
      } else {
        this.store.setState({ status: 'error', message: res.error.message });
      }
      return;
    }
    const d = res.data;
    this.format = d.format;
    const compatible = d.format === 'plain' || isTextareaCompatible(d.content);
    const text = d.format === 'plain' ? String(d.content) : docToText(d.content);
    const base = { note: d.note, title: d.note.title, text, revision: d.revision, save: 'saved' as const };
    if (!compatible) {
      this.store.setState({ ...base, status: 'readOnly', message: READONLY_FORMAT });
      return;
    }
    const lease = await this.deps.bridge.lease.acquire({ noteId: this.noteId, viewId: this.deps.viewId });
    if (this.disposed) {
      if (lease.ok && lease.data.granted) {
        void this.deps.bridge.lease.release({ noteId: this.noteId, viewId: this.deps.viewId, leaseToken: lease.data.leaseToken });
      }
      return;
    }
    if (lease.ok && lease.data.granted) {
      this.leaseToken = lease.data.leaseToken;
      this.store.setState({ ...base, status: 'ready' });
    } else if (lease.ok) {
      this.store.setState({ ...base, status: 'readOnly', message: READONLY_ELSEWHERE });
    } else {
      this.store.setState({ ...base, status: 'error', message: lease.error.message });
    }
  }

  setText(text: string): void {
    if (this.store.getState().status !== 'ready') return;
    this.store.setState({ text, save: this.store.getState().save === 'retrying' ? 'retrying' : 'pending' });
    this.dirtyText = true;
    this.failure = null;
    this.saveTimer.schedule();
  }

  rename(title: string): void {
    const state = this.store.getState();
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
    if (this.renaming) {
      await this.renaming;
    }
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

  /** Sends pending text, one request at a time; a change during a save causes one follow-up save. */
  private drain(): Promise<void> {
    if (this.saving) return this.saving;
    this.saving = (async () => {
      try {
        while (this.dirtyText && !this.disposed) {
          const state = this.store.getState();
          if (state.status !== 'ready' || this.leaseToken === null) break;
          this.dirtyText = false;
          const sentText = state.text;
          const requestId = this.deps.uuid();
          const content = this.format === 'rich' ? textToDoc(sentText) : sentText;
          let attempt = 0;
          this.store.setState({ save: 'saving' });
          for (;;) {
            const res = await this.deps.bridge.note.save({
              noteId: this.noteId,
              viewId: this.deps.viewId,
              leaseToken: this.leaseToken,
              baseRevision: this.store.getState().revision,
              requestId,
              format: this.format,
              content: content as never,
            });
            if (res.ok) {
              this.failure = null;
              this.store.setState({ revision: res.data.revision, save: this.dirtyText ? 'saving' : 'saved' });
              break;
            }
            const { code, message } = res.error;
            if (code === 'INTERNAL' && attempt < MAX_RETRIES) {
              attempt += 1;
              this.store.setState({ save: 'retrying' });
              await this.sleep(RETRY_DELAY_MS);
              continue;
            }
            this.failure = { code, message };
            if (code === 'CONFLICT' || code === 'LEASE_REQUIRED') {
              this.dirtyText = false;
              this.store.setState({ status: 'readOnly', save: 'error', message: READONLY_CHANGED });
            } else if (code === 'NOT_FOUND') {
              this.dirtyText = false;
              this.store.setState({ status: 'missing', save: 'error', message });
            } else {
              this.dirtyText = true; // keep the text; the user can retry by typing again
              this.store.setState({ save: 'error', message });
            }
            return;
          }
        }
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  /** Sends everything pending and resolves after the ack (or failure). */
  async flush(): Promise<FlushResult> {
    this.saveTimer.cancel();
    this.renameTimer.cancel();
    if (this.dirtyText) await this.drain();
    else if (this.saving) await this.saving;
    if (this.pendingTitle !== null || this.renaming) await this.runRename();
    if (this.failure) return { ok: false, code: this.failure.code, message: this.failure.message };
    return { ok: true };
  }

  async dispose(opts: { flush?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    if (opts.flush !== false) await this.flush();
    this.disposed = true;
    this.saveTimer.cancel();
    this.renameTimer.cancel();
    const token = this.leaseToken;
    this.leaseToken = null;
    if (token) await this.deps.bridge.lease.release({ noteId: this.noteId, viewId: this.deps.viewId, leaseToken: token });
  }
}
