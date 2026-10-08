import { MAX_QUEUED_OPENS, type AppOpenNoteEventType, type CloseBehaviorType } from '../../shared/contracts/windows';
import type { CloseChoice, CloseDialogOptions } from '../services/close-dialog';
import type { Logger } from '../services/logger';

/** The native main window; implemented over BrowserWindow by main-window.ts. */
export interface MainWindowHandle {
  readonly webContentsId: number;
  /** Starts loading the renderer; called once the controller can receive the window's events. */
  load(): void;
  show(): void;
  focus(): void;
  restore(): void;
  isMinimized(): boolean;
  close(): void;
  isDestroyed(): boolean;
}

export interface MainWindowEvents {
  /** The OS close button (or BrowserWindow.close()); call event.preventDefault() to keep the window. */
  onClose(event: { preventDefault(): void }): void;
  onClosed(): void;
  /** The renderer started a new document (reload or crash recovery); it is not ready until it asks for its state. */
  onLoadStarted(): void;
  /** The renderer document finished loading. */
  onLoaded(): void;
}

export interface MainWindowFactory {
  /** Creates and registers the window (not loaded yet); it shows itself when its first frame is ready. */
  create(events: MainWindowEvents): MainWindowHandle;
}

export interface MainWindowControllerDeps {
  factory: MainWindowFactory;
  sendOpenNote(webContentsId: number, event: AppOpenNoteEventType): void;
  closeBehavior(): CloseBehaviorType;
  rememberCloseBehavior(value: Exclude<CloseBehaviorType, 'ask'>): void;
  closeDialogOptions(): CloseDialogOptions;
  askClose(parentWebContentsId: number, options: CloseDialogOptions): Promise<CloseChoice>;
  /** Acknowledged flush of the given renderers (bounded per renderer); true when each confirmed its text is saved. */
  flush(webContentsIds: number[]): Promise<boolean>;
  quit(): void;
  isQuitting(): boolean;
  /** Runs once, after the first main window of the run finished loading (restore open stickies, D-068). */
  onFirstLoad?(): void;
  logger: Logger;
}

interface Current {
  handle: MainWindowHandle;
  /** The renderer asked for its state (D-071); before that, note opens are queued. */
  ready: boolean;
  closeAllowed: boolean;
  deciding: boolean;
}

/**
 * The single main window (plan section 8.7, D-066, D-071): created on demand (startup, second launch, tray, dock),
 * the close policy (ask, keep running in the background, quit) and note opens for a renderer that may still load.
 */
export class MainWindowController {
  private current: Current | null = null;
  private queue: AppOpenNoteEventType[] = [];
  private created = 0;
  private firstLoadSeen = false;

  constructor(private readonly deps: MainWindowControllerDeps) {}

  private live(): Current | null {
    return this.current && !this.current.handle.isDestroyed() ? this.current : null;
  }

  /** The live main window's webContents id, or null while it is closed. */
  webContentsId(): number | null {
    return this.live()?.handle.webContentsId ?? null;
  }

  isReady(): boolean {
    return this.live()?.ready ?? false;
  }

  /** Returns the main window, creating it when it is missing. */
  ensure(): MainWindowHandle {
    const live = this.live();
    if (live) return live.handle;
    const state: Current = {
      handle: this.deps.factory.create({
        onClose: (event) => this.onClose(state, event),
        onClosed: () => {
          if (this.current === state) this.current = null;
        },
        onLoadStarted: () => {
          state.ready = false;
        },
        onLoaded: () => {
          if (this.firstLoadSeen) return;
          this.firstLoadSeen = true;
          this.deps.onFirstLoad?.();
        },
      }),
      ready: false,
      closeAllowed: false,
      deciding: false,
    };
    this.current = state;
    if (this.created > 0) this.deps.logger.info('window: main recreated');
    this.created += 1;
    // Loading can emit events synchronously, so it starts only after the state above exists.
    state.handle.load();
    return state.handle;
  }

  /** Brings the main window to the front, recreating it if it was closed to the background. */
  show(): void {
    const existing = this.live();
    this.ensure();
    if (!existing) return;
    const { handle } = existing;
    if (handle.isMinimized()) handle.restore();
    handle.show();
    handle.focus();
  }

  /** Opens a note in a tab; queued (one entry per note, at most 50) until the renderer is ready. */
  openNote(noteId: string, takeEdit: boolean): void {
    this.show();
    const live = this.live();
    if (live?.ready) {
      this.deps.sendOpenNote(live.handle.webContentsId, { noteId, takeEdit });
      return;
    }
    this.queue = [...this.queue.filter((q) => q.noteId !== noteId), { noteId, takeEdit }].slice(-MAX_QUEUED_OPENS);
  }

  /** The main renderer asked for its state (`window:getState`): it is ready and takes the queued opens. */
  rendererReady(webContentsId: number): AppOpenNoteEventType[] {
    const live = this.live();
    if (!live || live.handle.webContentsId !== webContentsId) return [];
    live.ready = true;
    return this.queue.splice(0);
  }

  private onClose(state: Current, event: { preventDefault(): void }): void {
    if (state.closeAllowed || this.deps.isQuitting()) return;
    event.preventDefault();
    if (state.deciding) return;
    state.deciding = true;
    void this.decideClose(state).finally(() => {
      state.deciding = false;
    });
  }

  private async decideClose(state: Current): Promise<void> {
    let behavior = this.deps.closeBehavior();
    if (behavior === 'ask') {
      const answer = await this.deps.askClose(state.handle.webContentsId, this.deps.closeDialogOptions());
      if (answer.choice === 'cancel') return;
      if (answer.remember) this.deps.rememberCloseBehavior(answer.choice);
      behavior = answer.choice;
    }
    if (behavior === 'quit') {
      this.deps.quit();
      return;
    }
    const saved = await this.deps.flush([state.handle.webContentsId]);
    if (state.handle.isDestroyed()) return;
    if (!saved) {
      // D-055, D-072: the window stays open with its text; its renderer shows why.
      this.deps.logger.warn('window: main kept open (text not saved)');
      return;
    }
    state.closeAllowed = true;
    this.deps.logger.info('window: main closed to background');
    state.handle.close();
  }
}
