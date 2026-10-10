import type { CommentAnchorType } from '../../shared/comments/anchors';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { CommentTargetType, CommentThreadDtoType } from '../../shared/contracts/comments';
import type { Result } from '../../shared/contracts/envelope';
import { createStore, failOutcome, okOutcome, type Outcome, type Store } from '../state/store';

/**
 * What the open item's view does for its comments (D-165): a note tab marks and highlights text, a document viewer
 * shows markers. The view registers it while it shows the item; the sidebar works through it.
 */
export interface CommentAnchorHost {
  readonly target: CommentTargetType;
  /** The anchor and quote of a new comment at the current selection or place, or why there is none. */
  begin(): { anchor: CommentAnchorType; quote: string } | { error: string };
  /** The new thread was saved: the view anchors it (a note marks the text). */
  attach(threadId: string): void;
  /** No comment was written: the view forgets the place. */
  cancel(): void;
  /** Moves to a thread's anchor and flashes it; false when its anchor is gone. */
  reveal(thread: CommentThreadDtoType): boolean;
  /** A thread was deleted: the view removes its anchor. */
  detach(threadId: string): void;
  /** The threads as the view should show them (highlights, markers) and the selected one. */
  show(threads: readonly CommentThreadDtoType[], activeId: string | null): void;
  /** Threads whose anchor is gone from the item (a note's text was removed); null when the view cannot tell. */
  orphans(threads: readonly CommentThreadDtoType[]): ReadonlySet<string> | null;
  /** Called when `orphans` may have changed. */
  subscribe(listener: () => void): () => void;
}

export type CommentFilter = 'open' | 'resolved';

export interface CommentsState {
  target: CommentTargetType | null;
  status: 'none' | 'loading' | 'ready' | 'error';
  message: string | null;
  threads: readonly CommentThreadDtoType[];
  filter: CommentFilter;
  /** A new comment being written, with its anchor and quote; `seq` grows with each start (the field takes the focus). */
  draft: { anchor: CommentAnchorType; quote: string; seq: number } | null;
  activeThreadId: string | null;
  orphans: ReadonlySet<string>;
}

const INITIAL: CommentsState = { target: null, status: 'none', message: null, threads: [], filter: 'open', draft: null, activeThreadId: null, orphans: new Set() };

const sameTarget = (a: CommentTargetType | null, b: CommentTargetType | null) => a !== null && b !== null && a.kind === b.kind && a.id === b.id;

export interface CommentsStoreDeps {
  bridge: Pick<InfinityBridge, 'comments'>;
  notify: (message: string) => void;
  /** Shows the Details panel, where the comments are. */
  showPanel: () => void;
}

/** The comments of the item shown in the active tab (D-165): the sidebar's state and every comment action. */
export class CommentsStore {
  readonly store: Store<CommentsState> = createStore<CommentsState>(INITIAL);
  private host: CommentAnchorHost | null = null;
  private unsubscribeHost: (() => void) | null = null;
  private loadSeq = 0;

  constructor(private readonly deps: CommentsStoreDeps) {}

  /** The view showing an item takes over the sidebar until the returned function is called. */
  register(host: CommentAnchorHost): () => void {
    this.unregisterHost();
    this.host = host;
    this.unsubscribeHost = host.subscribe(() => this.refreshOrphans());
    const keepFilter = sameTarget(this.store.getState().target, host.target) ? this.store.getState().filter : 'open';
    this.store.setState({ ...INITIAL, target: host.target, status: 'loading', filter: keepFilter });
    void this.load();
    return () => {
      if (this.host !== host) return;
      this.unregisterHost();
      this.store.setState(INITIAL);
    };
  }

  private unregisterHost(): void {
    if (this.host && this.store.getState().draft) this.host.cancel();
    this.unsubscribeHost?.();
    this.unsubscribeHost = null;
    this.host = null;
  }

  /** Whether the active tab can take comments now. */
  available(): boolean {
    return this.host !== null && this.store.getState().status === 'ready';
  }

  async load(): Promise<void> {
    const host = this.host;
    if (!host) return;
    const seq = ++this.loadSeq;
    const res = await this.deps.bridge.comments.list({ target: host.target });
    if (seq !== this.loadSeq || this.host !== host) return;
    if (!res.ok) {
      this.store.setState({ status: 'error', message: res.error.message, threads: [] });
      return;
    }
    this.setThreads(res.data.threads);
    this.store.setState({ status: 'ready', message: null });
  }

  setFilter(filter: CommentFilter): void {
    this.store.setState({ filter });
  }

  /** "Comment" (bubble, Ctrl+Alt+M, palette): opens the composer for the selection, with the panel shown. */
  start(): void {
    const host = this.host;
    if (!host) return;
    const begun = host.begin();
    if ('error' in begun) {
      this.deps.notify(begun.error);
      return;
    }
    this.deps.showPanel();
    this.store.setState((s) => ({ ...s, filter: 'open', draft: { anchor: begun.anchor, quote: begun.quote, seq: (s.draft?.seq ?? 0) + 1 } }));
  }

  cancelDraft(): void {
    if (!this.store.getState().draft) return;
    this.host?.cancel();
    this.store.setState({ draft: null });
  }

  async submitDraft(body: string): Promise<Outcome> {
    const { draft, target } = this.store.getState();
    const host = this.host;
    if (!draft || !target || !host) return failOutcome('NOT_FOUND', 'Nothing to comment on');
    const res = await this.deps.bridge.comments.create({ target, anchor: draft.anchor, quote: draft.quote, body });
    if (!res.ok) return failOutcome(res.error.code, res.error.message);
    if (this.host !== host) return okOutcome(undefined);
    host.attach(res.data.thread.id);
    this.store.setState({ draft: null });
    this.upsert(res.data.thread, true);
    return okOutcome(undefined);
  }

  reply(threadId: string, body: string): Promise<Outcome> {
    return this.change(this.deps.bridge.comments.reply({ threadId, body }));
  }

  edit(commentId: string, body: string): Promise<Outcome> {
    return this.change(this.deps.bridge.comments.edit({ commentId, body }));
  }

  resolve(threadId: string, resolved: boolean): Promise<Outcome> {
    return this.change(this.deps.bridge.comments.resolve({ threadId, resolved }));
  }

  deleteReply(commentId: string): Promise<Outcome> {
    return this.change(this.deps.bridge.comments.delete({ commentId }));
  }

  async deleteThread(threadId: string): Promise<Outcome> {
    const res = await this.deps.bridge.comments.deleteThread({ threadId });
    if (!res.ok) return failOutcome(res.error.code, res.error.message);
    this.host?.detach(threadId);
    const s = this.store.getState();
    this.setThreads(s.threads.filter((t) => t.id !== threadId), s.activeThreadId === threadId ? null : s.activeThreadId);
    return okOutcome(undefined);
  }

  /** A click on a thread: selects it and reveals its anchor in the view. */
  select(threadId: string): void {
    const thread = this.store.getState().threads.find((t) => t.id === threadId);
    if (!thread) return;
    this.store.setState({ activeThreadId: threadId });
    this.host?.show(this.store.getState().threads, threadId);
    this.host?.reveal(thread);
  }

  private async change(call: Promise<Result<{ thread: CommentThreadDtoType }>>): Promise<Outcome> {
    const res = await call;
    if (!res.ok) return failOutcome(res.error.code, res.error.message);
    this.upsert(res.data.thread, false);
    return okOutcome(undefined);
  }

  private upsert(thread: CommentThreadDtoType, select: boolean): void {
    const s = this.store.getState();
    if (!sameTarget(s.target, thread.target)) return;
    const exists = s.threads.some((t) => t.id === thread.id);
    this.setThreads(exists ? s.threads.map((t) => (t.id === thread.id ? thread : t)) : [...s.threads, thread], select ? thread.id : s.activeThreadId);
  }

  private setThreads(threads: readonly CommentThreadDtoType[], activeThreadId = this.store.getState().activeThreadId): void {
    this.store.setState({ threads, activeThreadId });
    this.host?.show(threads, activeThreadId);
    this.refreshOrphans();
  }

  private refreshOrphans(): void {
    const orphans = this.host?.orphans(this.store.getState().threads) ?? new Set<string>();
    const prev = this.store.getState().orphans;
    if (orphans.size === prev.size && [...orphans].every((id) => prev.has(id))) return;
    this.store.setState({ orphans });
  }
}
