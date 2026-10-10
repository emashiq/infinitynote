import type { CapabilitiesType } from '../../shared/contracts/app';
import type { HexColor } from '../../shared/color';
import type { NoteColorType, TrashRestoreResponseType } from '../../shared/contracts/hierarchy';
import { MAX_OPEN_STICKIES, STICKY_DEFAULT, STICKY_HEADER_PX, STICKY_MESSAGES, STICKY_MIN, type StickyStateType, type StoredBoundsType } from '../../shared/contracts/stickies';
import { displayTitle } from '../../shared/names';
import { stickyBackground } from '../../shared/sticky-colors';
import { AppError } from '../services/app-error';
import type { Logger } from '../services/logger';
import { MSG } from '../services/messages';
import type { StickyMeta, StickyService } from '../services/sticky-service';
import { computeStickyBounds, displayFor, isReachable, type Placement, type Rect } from './display-clamp';
import type { DisplayProvider } from './display-provider';

/** The native window behind one sticky; implemented over BrowserWindow by sticky-window.ts. */
export interface StickyWindowHandle {
  readonly webContentsId: number;
  show(): void;
  showInactive(): void;
  focus(): void;
  destroy(): void;
  isDestroyed(): boolean;
  getBounds(): Rect;
  setBounds(bounds: Rect): void;
  setSize(width: number, height: number): void;
  getContentSize(): [number, number];
  setContentSize(width: number, height: number): void;
  setMinimumSize(width: number, height: number): void;
  setResizable(resizable: boolean): void;
  setAlwaysOnTop(on: boolean): void;
  setBackgroundColor(color: string): void;
  setTitle(title: string): void;
}

/** What the window reports back to the manager. */
export interface StickyWindowEvents {
  onReadyToShow(): void;
  /** The OS close button (or BrowserWindow.close()); call event.preventDefault() to keep the window. */
  onClose(event: { preventDefault(): void }): void;
  onClosed(): void;
  /** A move or resize, programmatic or by the user. */
  onBoundsChanged(): void;
}

export interface StickyWindowSpec {
  noteId: string;
  placement: Placement;
  alwaysOnTop: boolean;
  backgroundColor: string;
  title: string;
}

export interface StickyWindowFactory {
  create(spec: StickyWindowSpec, events: StickyWindowEvents): StickyWindowHandle;
}

export interface StickyTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** An app-computed placement, recorded for the E2E hooks. */
export interface StickyLayoutEntry {
  noteId: string;
  op: 'create' | 'clamp';
  bounds: Placement;
}

export interface StickyManagerDeps {
  service: Pick<
    StickyService,
    'enable' | 'disable' | 'setColor' | 'setTextColor' | 'meta' | 'metaMany' | 'state' | 'saveBounds' | 'setOpen' | 'setCollapsed' | 'setAlwaysOnTop' | 'openStickyIds' | 'closeAll'
  >;
  factory: StickyWindowFactory;
  displays: DisplayProvider;
  caps(): CapabilitiesType;
  /** Acknowledged flush of the given renderers (bounded per renderer); true when each confirmed its text is saved. */
  flush(webContentsIds: number[]): Promise<boolean>;
  resetViews(webContentsId: number): void;
  sendState(webContentsId: number, state: StickyStateType): void;
  trash: { restore(batchId: string): TrashRestoreResponseType };
  mainWindow: { openNote(noteId: string): void };
  restoreOnStartupEnabled(): boolean;
  theme(): 'light' | 'dark';
  logger: Logger;
  timers?: StickyTimers;
  boundsDebounceMs?: number;
  maxOpen?: number;
  onLayout?(entry: StickyLayoutEntry): void;
  /** Reveal state of locked stickies is per window (D-172): told when a note's window is created and when it is gone. */
  lockWindows?: { windowOpened(noteId: string, webContentsId: number): void; windowClosed(noteId: string, webContentsId: number): void };
}

interface Entry {
  noteId: string;
  handle: StickyWindowHandle;
  activation: number;
  /** The last metadata sent to the window, to send only real changes. */
  meta: StickyMeta;
  boundsTimer: unknown;
  /** Set while the hide sequence runs; a second hide or close waits for it. Resolves true when the window closed. */
  hiding: Promise<boolean> | null;
}

export const BOUNDS_DEBOUNCE_MS = 500;

/** Both come from StickyService.metaMany, so equal metadata serializes identically. */
const sameMeta = (a: StickyMeta, b: StickyMeta): boolean => JSON.stringify(a) === JSON.stringify(b);

const windowTitle = (title: string): string => `${displayTitle(title)} - Infinity Notes`;

/**
 * One native window per sticky note (plan section 8.5, D-065): float, hide, dock and remove, header state
 * (color, pin, collapse), bounds persistence and display clamping, trash and purge, restore at startup and quit.
 */
export class StickyManager {
  private readonly entries = new Map<string, Entry>();
  private readonly timers: StickyTimers;
  private readonly debounceMs: number;
  private readonly maxOpen: number;
  private readonly stopDisplays: () => void;
  private quitting = false;

  constructor(private readonly deps: StickyManagerDeps) {
    this.timers = deps.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) };
    this.debounceMs = deps.boundsDebounceMs ?? BOUNDS_DEBOUNCE_MS;
    this.maxOpen = deps.maxOpen ?? MAX_OPEN_STICKIES;
    this.stopDisplays = deps.displays.onChanged(() => this.reclampUnreachable());
  }

  private positioningSupported(): boolean {
    return this.deps.caps().windowPositioning.status !== 'unsupported';
  }

  private requireMeta(noteId: string): StickyMeta {
    const meta = this.deps.service.meta(noteId);
    if (!meta) throw new AppError('NOT_FOUND', STICKY_MESSAGES.missing);
    return meta;
  }

  // Reads ----------------------------------------------------------------------------------
  isFloating(noteId: string): boolean {
    return this.entries.has(noteId);
  }

  /** The open sticky windows, for the E2E hooks. */
  list(): ReadonlyArray<{ noteId: string; handle: StickyWindowHandle; activation: number }> {
    return [...this.entries.values()];
  }

  /** Everything the window of this note shows besides its content. */
  stateOf(noteId: string): StickyStateType {
    const meta = this.requireMeta(noteId);
    const stored = this.deps.service.state(noteId);
    return {
      noteId,
      ...meta,
      collapsed: stored.collapsed,
      alwaysOnTop: stored.alwaysOnTop,
      activation: this.entries.get(noteId)?.activation ?? 0,
    };
  }

  private sendState(entry: Entry): void {
    this.deps.sendState(entry.handle.webContentsId, this.stateOf(entry.noteId));
  }

  // Float ----------------------------------------------------------------------------------
  /** Opens (or focuses) the one window of a note; a second Float never creates a second window (INF-STKY-01). */
  async float(noteId: string): Promise<{ noteId: string; created: boolean }> {
    await this.entries.get(noteId)?.hiding;
    const existing = this.entries.get(noteId);
    if (!existing && this.entries.size >= this.maxOpen) throw new AppError('LIMIT_EXCEEDED', STICKY_MESSAGES.limit);
    this.deps.service.enable(noteId);
    if (existing) {
      existing.activation += 1;
      existing.handle.show();
      existing.handle.focus();
      this.sendState(existing);
      this.deps.logger.info(`sticky: open note=${noteId} created=false`);
      return { noteId, created: false };
    }
    this.open(noteId, 1, 'focus');
    this.deps.logger.info(`sticky: open note=${noteId} created=true`);
    return { noteId, created: true };
  }

  private open(noteId: string, activation: number, showMode: 'focus' | 'inactive'): void {
    const meta = this.requireMeta(noteId);
    const stored = this.deps.service.state(noteId);
    const caps = this.deps.caps();
    const placement = computeStickyBounds({
      stored: stored.bounds,
      displayHint: stored.displayId,
      displays: this.deps.displays.all(),
      primaryId: this.deps.displays.primaryId(),
      positioning: caps.windowPositioning.status,
      cascadeIndex: this.entries.size,
    });
    let entry: Entry | null = null;
    const handle = this.deps.factory.create(
      {
        noteId,
        placement,
        alwaysOnTop: stored.alwaysOnTop && caps.alwaysOnTop.status !== 'unsupported',
        backgroundColor: stickyBackground(meta.color, this.deps.theme()),
        title: windowTitle(meta.title),
      },
      {
        onReadyToShow: () => {
          if (handle.isDestroyed()) return;
          if (showMode === 'focus') handle.show();
          else handle.showInactive();
        },
        onClose: (event) => {
          if (entry) this.onClose(entry, event);
        },
        onClosed: () => {
          if (entry) this.forget(entry);
        },
        onBoundsChanged: () => {
          if (entry) this.scheduleBoundsSave(entry);
        },
      },
    );
    entry = { noteId, handle, activation, meta, boundsTimer: null, hiding: null };
    this.entries.set(noteId, entry);
    this.deps.lockWindows?.windowOpened(noteId, handle.webContentsId);
    // The stored bounds are already the expanded ones, so collapsing here must not overwrite them.
    if (stored.collapsed) this.applyCollapsed(entry, true, { saveExpanded: false });
    this.deps.onLayout?.({ noteId, op: 'create', bounds: placement });
  }

  /** Drops a window that is gone (closed or destroyed); nothing else references it afterwards. */
  private forget(entry: Entry): void {
    if (entry.boundsTimer !== null) this.timers.clearTimeout(entry.boundsTimer);
    entry.boundsTimer = null;
    if (this.entries.get(entry.noteId) === entry) this.entries.delete(entry.noteId);
    this.deps.lockWindows?.windowClosed(entry.noteId, entry.handle.webContentsId);
  }

  // Hide, dock, remove ----------------------------------------------------------------------
  private onClose(entry: Entry, event: { preventDefault(): void }): void {
    if (this.quitting) {
      // Quitting closes every window; open = 1 stays so the sticky can come back at the next start.
      this.saveBounds(entry);
      return;
    }
    event.preventDefault();
    void this.hideEntry(entry);
  }

  /**
   * Flush (acknowledged), save bounds, open = 0, its views leave live sync, destroy. A hidden sticky is a closed
   * window; the note and its sticky flag stay (INF-STKY-05, D-065). When the renderer did not confirm that its text
   * is saved (a failed save or no answer in time), the window stays open with its text (D-055, D-072); resolves false.
   */
  private hideEntry(entry: Entry): Promise<boolean> {
    entry.hiding ??= (async () => {
      const saved = await this.deps.flush([entry.handle.webContentsId]);
      if (entry.handle.isDestroyed()) {
        this.forget(entry);
        return true;
      }
      if (!saved) {
        entry.hiding = null;
        this.deps.logger.warn(`sticky: kept open note=${entry.noteId} (text not saved)`);
        return false;
      }
      this.saveBounds(entry);
      this.deps.service.setOpen(entry.noteId, false);
      this.deps.resetViews(entry.handle.webContentsId);
      entry.handle.destroy();
      this.forget(entry);
      return true;
    })();
    return entry.hiding;
  }

  /** Closes the window of a note if it floats; throws when it had to stay open because its text is not saved. */
  private async closeFloating(noteId: string): Promise<void> {
    const entry = this.entries.get(noteId);
    if (entry && !(await this.hideEntry(entry))) throw new AppError('INTERNAL', STICKY_MESSAGES.notSaved);
  }

  async hide(noteId: string): Promise<void> {
    if (!this.entries.has(noteId)) return;
    this.deps.logger.info(`sticky: hide note=${noteId}`);
    await this.closeFloating(noteId);
  }

  /**
   * Hides the window (if floating) and opens the note in a tab; the tab never races the sticky,
   * and it never opens while the sticky still holds unsaved text.
   */
  async dock(noteId: string): Promise<void> {
    this.requireMeta(noteId);
    await this.closeFloating(noteId);
    this.deps.logger.info(`sticky: dock note=${noteId}`);
    this.deps.mainWindow.openNote(noteId);
  }

  /** "Remove from stickies": dock, clear the sticky flag and forget the window state. */
  async remove(noteId: string): Promise<void> {
    this.requireMeta(noteId);
    await this.closeFloating(noteId);
    this.deps.service.disable(noteId);
    this.deps.mainWindow.openNote(noteId);
  }

  // Trash ----------------------------------------------------------------------------------
  /** Restores the trash batch of the sticky's own note. */
  restore(noteId: string): TrashRestoreResponseType {
    const meta = this.requireMeta(noteId);
    if (!meta.trashed) throw new AppError('VALIDATION_FAILED', STICKY_MESSAGES.notInTrash);
    if (!meta.trashed.batchId) throw new AppError('NOT_FOUND', MSG.noBatch);
    return this.deps.trash.restore(meta.trashed.batchId);
  }

  /**
   * After any committed tree change: sends the new state to windows whose title, path, color or trash state changed,
   * and closes the windows of purged notes (their trash state has no editor to flush).
   */
  onTreeChanged(): void {
    if (this.entries.size === 0) return;
    const metas = this.deps.service.metaMany([...this.entries.keys()]);
    for (const entry of [...this.entries.values()]) {
      const meta = metas.get(entry.noteId);
      if (!meta) {
        this.deps.logger.info(`sticky: purged note=${entry.noteId}`);
        this.deps.resetViews(entry.handle.webContentsId);
        entry.handle.destroy();
        this.forget(entry);
        continue;
      }
      this.refresh(entry, meta);
    }
  }

  private refresh(entry: Entry, meta: StickyMeta): void {
    if (sameMeta(entry.meta, meta)) return;
    if (entry.meta.color !== meta.color) entry.handle.setBackgroundColor(stickyBackground(meta.color, this.deps.theme()));
    if (entry.meta.title !== meta.title) entry.handle.setTitle(windowTitle(meta.title));
    entry.meta = meta;
    this.sendState(entry);
  }

  // Header actions --------------------------------------------------------------------------
  /** Recolors a sticky; answers its window state while it floats, else null. */
  setColor(noteId: string, color: NoteColorType): StickyStateType | null {
    this.deps.service.setColor(noteId, color);
    return this.refreshFloating(noteId);
  }

  /** Sets a sticky's default text color (null: Automatic); answers its window state while it floats, else null. */
  setTextColor(noteId: string, textColor: HexColor | null): StickyStateType | null {
    this.deps.service.setTextColor(noteId, textColor);
    return this.refreshFloating(noteId);
  }

  private refreshFloating(noteId: string): StickyStateType | null {
    const entry = this.entries.get(noteId);
    if (!entry) return null;
    this.refresh(entry, this.requireMeta(noteId));
    return this.stateOf(noteId);
  }

  /** The theme changed: preset colors have a variant per theme, so every window's background follows. */
  themeChanged(): void {
    for (const entry of this.entries.values()) entry.handle.setBackgroundColor(stickyBackground(entry.meta.color, this.deps.theme()));
  }

  setPinned(noteId: string, pinned: boolean): StickyStateType {
    if (this.deps.caps().alwaysOnTop.status === 'unsupported') throw new AppError('UNSUPPORTED', STICKY_MESSAGES.unsupported);
    this.requireMeta(noteId);
    this.entries.get(noteId)?.handle.setAlwaysOnTop(pinned);
    this.deps.service.setAlwaysOnTop(noteId, pinned);
    return this.pushState(noteId);
  }

  setCollapsed(noteId: string, collapsed: boolean): StickyStateType {
    this.requireMeta(noteId);
    const entry = this.entries.get(noteId);
    if (entry && this.deps.service.state(noteId).collapsed !== collapsed) this.applyCollapsed(entry, collapsed, { saveExpanded: true });
    this.deps.service.setCollapsed(noteId, collapsed);
    return this.pushState(noteId);
  }

  private pushState(noteId: string): StickyStateType {
    const state = this.stateOf(noteId);
    const entry = this.entries.get(noteId);
    if (entry) this.deps.sendState(entry.handle.webContentsId, state);
    return state;
  }

  /**
   * Collapse keeps only the 36 px header (fixed size); expand restores the stored expanded size at the current
   * position (INF-STKY-04, D-070).
   */
  private applyCollapsed(entry: Entry, collapsed: boolean, opts: { saveExpanded: boolean }): void {
    const { handle } = entry;
    if (collapsed) {
      if (opts.saveExpanded) this.saveBounds(entry, { collapsed: false });
      handle.setMinimumSize(STICKY_MIN.width, 0);
      handle.setContentSize(handle.getContentSize()[0], STICKY_HEADER_PX);
      handle.setResizable(false);
      return;
    }
    const stored = this.deps.service.state(entry.noteId).bounds;
    handle.setSize(stored?.width ?? STICKY_DEFAULT.width, stored?.height ?? STICKY_DEFAULT.height);
    handle.setMinimumSize(STICKY_MIN.width, STICKY_MIN.height);
    handle.setResizable(true);
  }

  // Bounds ---------------------------------------------------------------------------------
  private scheduleBoundsSave(entry: Entry): void {
    if (entry.boundsTimer !== null) this.timers.clearTimeout(entry.boundsTimer);
    entry.boundsTimer = this.timers.setTimeout(() => {
      entry.boundsTimer = null;
      if (!entry.handle.isDestroyed()) this.saveBounds(entry);
    }, this.debounceMs);
  }

  /**
   * Stores the outer bounds of the expanded window. While collapsed only the position changes. Where positioning
   * is unsupported the position is stored as null (D-068).
   */
  private saveBounds(entry: Entry, opts: { collapsed?: boolean } = {}): void {
    if (entry.boundsTimer !== null) this.timers.clearTimeout(entry.boundsTimer);
    entry.boundsTimer = null;
    const b = entry.handle.getBounds();
    const current = this.deps.service.state(entry.noteId);
    const collapsed = opts.collapsed ?? current.collapsed;
    const positioned = this.positioningSupported();
    const size = collapsed
      ? { width: current.bounds?.width ?? STICKY_DEFAULT.width, height: current.bounds?.height ?? STICKY_DEFAULT.height }
      : { width: Math.max(STICKY_MIN.width, Math.round(b.width)), height: Math.max(STICKY_HEADER_PX, Math.round(b.height)) };
    const bounds: StoredBoundsType = { x: positioned ? Math.round(b.x) : null, y: positioned ? Math.round(b.y) : null, ...size };
    this.deps.service.saveBounds(entry.noteId, bounds, positioned ? displayFor(b, this.deps.displays.all()) : null);
  }

  /** After a display change only windows that are no longer reachable move (plan section 8.6, R4-06). */
  private reclampUnreachable(): void {
    if (!this.positioningSupported()) return;
    const displays = this.deps.displays.all();
    for (const entry of this.entries.values()) {
      const current = entry.handle.getBounds();
      if (isReachable(current, displays)) continue;
      const stored = this.deps.service.state(entry.noteId);
      const placement = computeStickyBounds({
        stored: { x: current.x, y: current.y, width: stored.bounds?.width ?? current.width, height: stored.bounds?.height ?? current.height },
        displayHint: stored.displayId,
        displays,
        primaryId: this.deps.displays.primaryId(),
        positioning: 'supported',
        cascadeIndex: 0,
      });
      // A collapsed window keeps its header-only size; only the position is recovered.
      const size = stored.collapsed ? { width: current.width, height: current.height } : { width: placement.width, height: placement.height };
      entry.handle.setBounds({ x: placement.x ?? current.x, y: placement.y ?? current.y, ...size });
      this.saveBounds(entry);
      this.deps.logger.info(`sticky: clamp note=${entry.noteId}`);
      this.deps.onLayout?.({ noteId: entry.noteId, op: 'clamp', bounds: placement });
    }
  }

  // Startup and quit --------------------------------------------------------------------------
  /**
   * Reopens the stickies that were open at the last quit when the setting is on; they start without taking edit
   * control (activation 0) and without stealing focus (INF-STKY-09). With the setting off every row is closed.
   */
  restoreOnStartup(): void {
    if (!this.deps.restoreOnStartupEnabled()) {
      this.deps.service.closeAll();
      return;
    }
    const ids = this.deps.service.openStickyIds().slice(0, this.maxOpen);
    // Under Wayland an inactive new window can stay invisible (probe), so it is shown normally there.
    const showMode = this.deps.caps().sessionType === 'wayland' ? 'focus' : 'inactive';
    for (const noteId of ids) this.open(noteId, 0, showMode);
    this.deps.logger.info(`sticky: restore-on-startup count=${ids.length}`);
  }

  /** The app is quitting (or the session ends): closing windows no longer hides them, and their bounds are saved. */
  prepareQuit(): void {
    this.quitting = true;
    for (const entry of this.entries.values()) {
      if (!entry.handle.isDestroyed()) this.saveBounds(entry);
    }
  }

  /** A quit was canceled (a window could not save): closing a sticky hides it again. */
  cancelQuit(): void {
    this.quitting = false;
  }

  dispose(): void {
    this.stopDisplays();
    for (const entry of this.entries.values()) this.forget(entry);
  }
}
