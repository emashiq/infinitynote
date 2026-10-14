import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { CommentThreadDtoType } from '../../shared/contracts/comments';
import { askAiProblem, type AiChoices, type AnswerPlacement } from '../ai/ai-request';
import type { AnchorChoice, CommentAnchorHost } from '../comments/comments-store';
import { createNoteCommentHost } from '../comments/note-comment-host';
import type { EditorHandle } from '../editor/editor-handle';
import type { AiStarter } from '../editor/editor-services';
import { createStore, failOutcome, okOutcome, type Outcome, type Store } from '../state/store';

export interface StickyAiState {
  /** The part an action is being chosen for (the Ask AI panel is open). */
  draft: AnchorChoice | null;
  /** The AI thread the window shows: the one just asked, until it is closed. */
  thread: CommentThreadDtoType | null;
}

/**
 * AI actions in a sticky window (D-190): the same Ask AI panel and thread as the main window, on the sticky's own note.
 * The thread is anchored by the note's comment mark like a comment (through the note's comment host, D-165), so it is
 * also in the Details panel when the note is open in the main window. A sticky shows one thread at a time.
 */
export class StickyAi {
  readonly store: Store<StickyAiState> = createStore<StickyAiState>({ draft: null, thread: null });
  readonly starter: AiStarter;
  readonly noteId: string;
  private readonly host: CommentAnchorHost;

  constructor(
    private readonly deps: {
      bridge: Pick<InfinityBridge, 'ai'>;
      noteId: string;
      handle: EditorHandle;
      notify: (message: string) => void;
      /** Whether AI actions are on (Settings → AI). */
      enabled: () => boolean;
    },
  ) {
    this.noteId = deps.noteId;
    this.host = createNoteCommentHost(deps.noteId, deps.handle);
    this.starter = { enabled: deps.enabled, start: () => this.start() };
  }

  /** "Ask AI…" from the toolbar, the note menu or Ctrl+Shift+I. */
  start(): void {
    const begun = this.host.begin();
    if ('error' in begun) {
      this.deps.notify(askAiProblem(begun.error));
      return;
    }
    this.store.setState({ draft: begun });
  }

  cancel(): void {
    if (!this.store.getState().draft) return;
    this.host.cancel();
    this.store.setState({ draft: null });
  }

  async submit(choices: AiChoices): Promise<Outcome> {
    const draft = this.store.getState().draft;
    if (!draft) return failOutcome('NOT_FOUND', 'Nothing to ask about');
    const res = await this.deps.bridge.ai.ask({ target: this.host.target, anchor: draft.anchor, quote: draft.quote, selection: draft.text ?? draft.quote, ...choices });
    if (!res.ok) return failOutcome(res.error.code, res.error.message);
    this.host.attach(res.data.thread.id);
    this.store.setState({ draft: null });
    this.show(res.data.thread);
    return okOutcome(undefined);
  }

  async followUp(prompt: string): Promise<Outcome> {
    const thread = this.store.getState().thread;
    if (!thread) return failOutcome('NOT_FOUND', 'Nothing to ask about');
    const res = await this.deps.bridge.ai.followUp({ threadId: thread.id, prompt });
    if (!res.ok) return failOutcome(res.error.code, res.error.message);
    this.show(res.data.thread);
    return okOutcome(undefined);
  }

  async stop(): Promise<void> {
    const thread = this.store.getState().thread;
    if (thread) await this.deps.bridge.ai.stop({ threadId: thread.id });
  }

  /** Deletes the thread shown and its anchor. */
  async remove(): Promise<Outcome> {
    const thread = this.store.getState().thread;
    if (!thread) return okOutcome(undefined);
    const res = await this.deps.bridge.ai.deleteThread({ threadId: thread.id });
    if (!res.ok) return failOutcome(res.error.code, res.error.message);
    this.host.detach(thread.id);
    this.close();
    return okOutcome(undefined);
  }

  place(text: string, placement: AnswerPlacement): boolean {
    const thread = this.store.getState().thread;
    return thread !== null && (this.host.placeAnswer?.(thread.id, text, placement) ?? false);
  }

  /** Closes the thread (it stays in the note); its highlight goes. */
  close(): void {
    this.store.setState({ thread: null });
    this.host.show([], null);
  }

  private show(thread: CommentThreadDtoType): void {
    this.store.setState({ thread });
    this.host.show([thread], thread.id);
    if (!thread.running) return;
    void this.deps.bridge.ai.wait({ threadId: thread.id }).then((res) => {
      if (res.ok && this.store.getState().thread?.id === thread.id) this.show(res.data.thread);
    });
  }
}
