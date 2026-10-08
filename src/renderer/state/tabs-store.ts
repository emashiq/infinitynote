import type { InfinityBridge } from '../../shared/contracts/bridge';
import { DEFAULT_SESSION, type TabSessionType, type TabType } from '../../shared/contracts/session';
import { activateTab, closeTab, nextTab, noteTabId, openTab, prevTab, removeNoteTabs, setTabScroll } from '../../shared/tabs/tab-session';
import { NoteController, type FlushResult } from '../notes/note-controller';
import { closedTabsNotice, type NoticeStore } from './notice-store';
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

  /** Makes the held controller match the active tab. The previous controller must already be disposed. */
  private syncController(): void {
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
      void this.controller.open();
    }
    if (this.store.getState().controllerNoteId !== noteId) this.store.setState({ controllerNoteId: noteId });
  }

  /** Flushes and releases the active note. Returns false when a save failure must keep the tab open. */
  private async leaveActive(): Promise<boolean> {
    const c = this.controller;
    if (!c) return true;
    const r = await c.flush();
    if (!r.ok && r.code === 'INTERNAL') {
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
  private async switchTo(next: TabSessionType): Promise<boolean> {
    if (next === this.session) return true;
    if (next.activeTabId !== this.session.activeTabId && !(await this.leaveActive())) return false;
    this.store.setState({ session: next });
    this.syncController();
    this.schedulePersist();
    return true;
  }

  openNote(noteId: string): Promise<boolean> {
    return this.openTabInternal({ id: noteTabId(noteId), kind: 'note', noteId });
  }

  openPage(kind: PageKind): Promise<boolean> {
    return this.openTabInternal({ id: `page:${kind}`, kind } as TabType);
  }

  private openTabInternal(tab: TabType): Promise<boolean> {
    return this.run(async () => {
      const r = openTab(this.session, tab);
      if ('error' in r) {
        this.deps.notices.push(TAB_LIMIT_NOTICE, 'info');
        return false;
      }
      return this.switchTo(r.session);
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
        await this.controller.dispose({ flush: false });
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
