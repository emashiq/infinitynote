import type { InfinityBridge } from '../../shared/contracts/bridge';
import { DEFAULT_SESSION, type TabSessionType, type TabType } from '../../shared/contracts/session';
import { activateTab, closeTab, nextTab, noteTabId, openTab, prevTab, removeNoteTabs, setTabScroll } from '../../shared/tabs/tab-session';
import { displayTitle } from '../../shared/names';
import { NoteController, textIsSafe, type FlushResult } from '../notes/note-controller';
import { closedTabsNotice, trashedDraftNotice, type NoticeStore } from './notice-store';
import { createDebouncer, createStore, type Store, type Timers } from './store';

export type PageKind = 'stickies' | 'reminders' | 'settings';

export interface TabsState {
  session: TabSessionType;
  ready: boolean;
  /** Note id of the controller currently held, so views re-render when it is replaced. */
  controllerNoteId: string | null;
}

export const SCROLL_DEBOUNCE_MS = 500;
export const SAVE_FAILED_NOTICE = 'Could not save this note. The tab stays open.';
export const TAB_LIMIT_NOTICE = 'You have 200 open tabs. Close some tabs to open more.';

function isTrashedConflict(r: FlushResult): boolean {
  return !r.ok && r.code === 'CONFLICT' && (r.details as { reason?: unknown } | undefined)?.reason === 'trashed';
}

export interface TabsDeps {
  bridge: InfinityBridge;
  notices: NoticeStore;
  timers: Timers;
  viewId: string;
  uuid: () => string;
}

export class TabsStore {
  readonly store: Store<TabsState> = createStore<TabsState>({ session: DEFAULT_SESSION, ready: false, controllerNoteId: null });
  private controller: NoteController | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private persistDirty = false;
  private persisting: Promise<void> | null = null;
  private readonly pendingScroll = new Map<string, number>();
  private readonly scrollTimer;

  constructor(private readonly deps: TabsDeps) {
    this.scrollTimer = createDebouncer(deps.timers, SCROLL_DEBOUNCE_MS, () => this.applyScroll());
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.catch(() => undefined);
    return next;
  }

  private get session(): TabSessionType {
    return this.store.getState().session;
  }

  activeController(): NoteController | null {
    return this.controller;
  }

  // Persistence -----------------------------------------------------------------
  private schedulePersist(): void {
    this.persistDirty = true;
    if (this.persisting) return;
    this.persisting = (async () => {
      try {
        while (this.persistDirty) {
          this.persistDirty = false;
          await this.deps.bridge.session.set({ session: this.session });
        }
      } finally {
        this.persisting = null;
      }
    })();
  }

  /** Resolves when no session write is pending (used by tests and shutdown paths). */
  async idle(): Promise<void> {
    this.applyScrollNow();
    while (this.persisting) await this.persisting;
  }

  private applyScroll(): void {
    if (this.pendingScroll.size === 0) return;
    let s = this.session;
    for (const [id, px] of this.pendingScroll) s = setTabScroll(s, id, px);
    this.pendingScroll.clear();
    if (s !== this.session) {
      this.store.setState({ session: s });
      this.schedulePersist();
    }
  }
  private applyScrollNow(): void {
    this.scrollTimer.cancel();
    this.applyScroll();
  }

  setScrollTop(tabId: string, px: number): void {
    this.pendingScroll.set(tabId, px);
    this.scrollTimer.schedule();
  }

  // Controller management --------------------------------------------------------
  private activeNoteId(): string | null {
    const tab = this.session.tabs.find((t) => t.id === this.session.activeTabId);
    return tab && tab.kind === 'note' ? tab.noteId : null;
  }

  /**
   * Makes the held controller match the active tab. The previous controller must already be disposed. A new
   * controller takes edit control when `mode` is `take` (a docked or app-opened note, D-065).
   */
  private syncController(mode: 'acquire' | 'take' = 'acquire'): void {
    const noteId = this.activeNoteId();
    if (noteId === null) {
      this.controller = null;
    } else if (!this.controller || this.controller.noteId !== noteId) {
      this.controller = new NoteController({
        bridge: this.deps.bridge,
        noteId,
        viewId: this.deps.viewId,
        timers: this.deps.timers,
        uuid: this.deps.uuid,
      });
      void this.controller.open(mode);
    }
    if (this.store.getState().controllerNoteId !== noteId) this.store.setState({ controllerNoteId: noteId });
  }

  /**
   * Flushes and releases the active note. Returns false when a save failure must keep the tab open: only a
   * failure after which main kept the edits as a draft (CONFLICT, LEASE_REQUIRED) or the note is gone (NOT_FOUND)
   * lets the tab go (D-055).
   */
  private async leaveActive(): Promise<boolean> {
    const c = this.controller;
    if (!c) return true;
    const r = await c.flush();
    if (!textIsSafe(r)) {
      this.deps.notices.push(SAVE_FAILED_NOTICE, 'error');
      return false;
    }
    await c.dispose({ flush: false });
    this.controller = null;
    return true;
  }

  async flushActive(): Promise<FlushResult> {
    const c = this.controller;
    return c ? c.flush() : { ok: true };
  }

  // Lifecycle -----------------------------------------------------------------
  async init(): Promise<void> {
    const res = await this.deps.bridge.session.get();
    if (res.ok) {
      this.store.setState({ session: res.data.session, ready: true });
      const { trashed, missing, duplicates } = res.data.dropped;
      if (trashed + missing > 0) this.deps.notices.push(closedTabsNotice(trashed + missing, missing > 0), 'info');
      if (trashed + missing + duplicates > 0) this.schedulePersist();
    } else {
      this.store.setState({ ready: true });
    }
    this.syncController();
  }

  // Operations ------------------------------------------------------------------
  private async switchTo(next: TabSessionType, mode: 'acquire' | 'take' = 'acquire'): Promise<boolean> {
    if (next === this.session) return true;
    // A scroll position reported just before switching must reach the session the next view reads.
    this.applyScrollNow();
    if (next.activeTabId !== this.session.activeTabId && !(await this.leaveActive())) return false;
    this.store.setState({ session: next });
    this.syncController(mode);
    this.schedulePersist();
    return true;
  }

  /**
   * Opens or activates a note tab; `takeEdit` also takes edit control (dock and "Open in app", D-065); `blockId` reveals
   * a reminder's block once the editor shows the note (D-074).
   */
  async openNote(noteId: string, opts: { takeEdit?: boolean; blockId?: string | null } = {}): Promise<boolean> {
    const opened = await this.openTabInternal({ id: noteTabId(noteId), kind: 'note', noteId }, opts.takeEdit ? 'take' : 'acquire');
    if (opened && opts.blockId && this.controller?.noteId === noteId) this.controller.requestReveal(opts.blockId);
    return opened;
  }

  openPage(kind: PageKind): Promise<boolean> {
    return this.openTabInternal({ id: `page:${kind}`, kind } as TabType);
  }

  private openTabInternal(tab: TabType, mode: 'acquire' | 'take' = 'acquire'): Promise<boolean> {
    return this.run(async () => {
      const r = openTab(this.session, tab);
      if ('error' in r) {
        this.deps.notices.push(TAB_LIMIT_NOTICE, 'info');
        return false;
      }
      if (!(await this.switchTo(r.session, mode))) return false;
      // The tab was already active: its controller exists, so it takes control itself.
      if (mode === 'take' && tab.kind === 'note' && this.controller?.noteId === tab.noteId) await this.controller.ensureEditing();
      return true;
    });
  }

  activate(id: string): Promise<boolean> {
    return this.run(() => this.switchTo(activateTab(this.session, id)));
  }

  next(): Promise<boolean> {
    return this.run(() => this.switchTo(nextTab(this.session)));
  }

  prev(): Promise<boolean> {
    return this.run(() => this.switchTo(prevTab(this.session)));
  }

  close(id: string): Promise<boolean> {
    return this.run(async () => {
      if (id === 'home' || !this.session.tabs.some((t) => t.id === id)) return false;
      const next = closeTab(this.session, id);
      if (id === this.session.activeTabId) {
        if (!(await this.leaveActive())) return false;
      }
      this.store.setState({ session: next });
      this.syncController();
      this.schedulePersist();
      return true;
    });
  }

  closeActive(): Promise<boolean> {
    return this.close(this.session.activeTabId);
  }

  /** Closes tabs whose notes were trashed. Returns the number of tabs removed. */
  closeNoteTabs(noteIds: readonly string[]): Promise<number> {
    return this.run(async () => {
      const { session, removed } = removeNoteTabs(this.session, noteIds);
      if (removed === 0) return 0;
      const activeGone = session.activeTabId !== this.session.activeTabId;
      if (activeGone && this.controller) {
        // Flush, not discard: main stores the pending edits of a trashed note as a recovered draft (F-02-1).
        const c = this.controller;
        const r = await c.flush();
        if (isTrashedConflict(r)) this.deps.notices.push(trashedDraftNotice(displayTitle(c.store.getState().note?.title ?? '')), 'info');
        await c.dispose({ flush: false });
        this.controller = null;
      }
      this.store.setState({ session });
      this.syncController();
      this.schedulePersist();
      return removed;
    });
  }

  async dispose(): Promise<void> {
    this.applyScrollNow();
    await this.run(async () => {
      if (this.controller) await this.controller.dispose();
      this.controller = null;
    });
    await this.idle();
  }
}
