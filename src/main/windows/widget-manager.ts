import type { CapabilitiesType } from '../../shared/contracts/app';
import { REMINDER_MESSAGES } from '../../shared/contracts/reminders';
import { WIDGET_DEFAULT, WIDGET_HEADER_PX, WIDGET_MIN, type WidgetStateType } from '../../shared/contracts/widget';
import type { StoredBoundsType } from '../../shared/contracts/stickies';
import type { WindowState, WindowStatePatch } from '../db/repositories/window-state-repo';
import { AppError } from '../services/app-error';
import type { Logger } from '../services/logger';
import { realTimers, type Timers } from '../services/timers';
import { computeStickyBounds, displayFor, type Placement, type Rect } from './display-clamp';
import type { DisplayProvider } from './display-provider';

/** The native widget window; implemented over BrowserWindow by widget-window.ts. */
export interface WidgetWindowHandle {
  readonly webContentsId: number;
  show(): void;
  showInactive(): void;
  focus(): void;
  destroy(): void;
  isDestroyed(): boolean;
  getBounds(): Rect;
  setSize(width: number, height: number): void;
  getContentSize(): [number, number];
  setContentSize(width: number, height: number): void;
  setMinimumSize(width: number, height: number): void;
  setResizable(resizable: boolean): void;
  setAlwaysOnTop(on: boolean): void;
}

export interface WidgetWindowEvents {
  onReadyToShow(): void;
  /** The OS close button (or BrowserWindow.close()); call event.preventDefault() to keep the window. */
  onClose(event: { preventDefault(): void }): void;
  onClosed(): void;
  onBoundsChanged(): void;
}

export interface WidgetWindowFactory {
  create(spec: { placement: Placement; alwaysOnTop: boolean }, events: WidgetWindowEvents): WidgetWindowHandle;
}

export interface WidgetManagerDeps {
  store: { get(): WindowState; patch(patch: WindowStatePatch): void };
  factory: WidgetWindowFactory;
  displays: DisplayProvider;
  caps(): CapabilitiesType;
  /** `widget:state` to the main window and the widget (the Reminders page shows Show or Hide widget). */
  emitState(state: WidgetStateType, widgetWebContentsId: number | null): void;
  logger: Logger;
  timers?: Timers;
  boundsDebounceMs?: number;
}

export const WIDGET_BOUNDS_DEBOUNCE_MS = 500;
const GEOMETRY = { default: WIDGET_DEFAULT, min: WIDGET_MIN };

interface Entry {
  handle: WidgetWindowHandle;
  boundsTimer: unknown;
}

/**
 * The optional reminder widget (D-081, plan section 8.8): one window, default off. Hide (its button or the OS close)
 * saves the bounds and destroys the window; one open at quit comes back at the next start. Collapse keeps the 36 px
 * header; keep-on-top only where the desktop supports it. The widget owns no scheduler (INF-WIDG-03).
 */
export class WidgetManager {
  private entry: Entry | null = null;
  private quitting = false;
  private readonly timers: Timers;
  private readonly debounceMs: number;

  constructor(private readonly deps: WidgetManagerDeps) {
    this.timers = deps.timers ?? realTimers;
    this.debounceMs = deps.boundsDebounceMs ?? WIDGET_BOUNDS_DEBOUNCE_MS;
  }

  private positioningSupported(): boolean {
    return this.deps.caps().windowPositioning.status !== 'unsupported';
  }

  private pinSupported(): boolean {
    return this.deps.caps().alwaysOnTop.status !== 'unsupported';
  }

  /** The live widget window, for the E2E hooks and the event routing. */
  handle(): WidgetWindowHandle | null {
    return this.entry && !this.entry.handle.isDestroyed() ? this.entry.handle : null;
  }

  state(): WidgetStateType {
    const stored = this.deps.store.get();
    return { open: this.handle() !== null, collapsed: stored.collapsed, alwaysOnTop: stored.alwaysOnTop };
  }

  private emit(): WidgetStateType {
    const state = this.state();
    this.deps.emitState(state, this.handle()?.webContentsId ?? null);
    return state;
  }

  /** Opens the widget or brings it to the front (Reminders page, Settings, tray "Show widget"). */
  show(): WidgetStateType {
    const live = this.handle();
    if (live) {
      live.show();
      live.focus();
    } else {
      this.open('focus');
    }
    this.deps.store.patch({ open: true });
    this.deps.logger.info('widget: show');
    return this.emit();
  }

  /** Hide button or OS close: bounds saved, open = 0, the window destroyed (no hidden renderer). */
  hide(): WidgetStateType {
    const entry = this.entry;
    if (entry && !entry.handle.isDestroyed()) {
      this.saveBounds(entry);
      this.deps.store.patch({ open: false });
      entry.handle.destroy();
      this.forget(entry);
      this.deps.logger.info('widget: hide');
    }
    return this.emit();
  }

  setCollapsed(collapsed: boolean): WidgetStateType {
    const entry = this.entry;
    if (entry && this.deps.store.get().collapsed !== collapsed) {
      if (collapsed) this.saveBounds(entry);
      this.applyCollapsed(entry.handle, collapsed);
    }
    this.deps.store.patch({ collapsed });
    return this.emit();
  }

  setPinned(pinned: boolean): WidgetStateType {
    if (!this.pinSupported()) throw new AppError('UNSUPPORTED', REMINDER_MESSAGES.unsupported);
    this.handle()?.setAlwaysOnTop(pinned);
    this.deps.store.patch({ alwaysOnTop: pinned });
    return this.emit();
  }

  /** Reopens a widget that was open at the last quit, without taking the focus. */
  restoreOnStartup(): void {
    if (!this.deps.store.get().open || this.handle()) return;
    // Under Wayland an inactive new window can stay invisible (Phase 04 probe), so it is shown normally there.
    this.open(this.deps.caps().sessionType === 'wayland' ? 'focus' : 'inactive');
    this.deps.logger.info('widget: restore');
    this.emit();
  }

  /** Quitting: the window closes with the app and keeps open = 1, so it comes back at the next start. */
  prepareQuit(): void {
    this.quitting = true;
    if (this.entry && !this.entry.handle.isDestroyed()) this.saveBounds(this.entry);
  }

  cancelQuit(): void {
    this.quitting = false;
  }

  private open(showMode: 'focus' | 'inactive'): void {
    const stored = this.deps.store.get();
    const placement = computeStickyBounds({
      stored: stored.bounds,
      displayHint: stored.displayId,
      displays: this.deps.displays.all(),
      primaryId: this.deps.displays.primaryId(),
      positioning: this.deps.caps().windowPositioning.status,
      cascadeIndex: 0,
      geometry: GEOMETRY,
    });
    let entry: Entry | null = null;
    const handle = this.deps.factory.create(
      { placement, alwaysOnTop: stored.alwaysOnTop && this.pinSupported() },
      {
        onReadyToShow: () => {
          if (handle.isDestroyed()) return;
          if (showMode === 'focus') handle.show();
          else handle.showInactive();
        },
        onClose: (event) => {
          if (!entry) return;
          if (this.quitting) {
            this.saveBounds(entry);
            return;
          }
          event.preventDefault();
          this.hide();
        },
        onClosed: () => {
          if (entry) this.forget(entry);
        },
        onBoundsChanged: () => {
          if (entry) this.scheduleBoundsSave(entry);
        },
      },
    );
    entry = { handle, boundsTimer: null };
    this.entry = entry;
    if (stored.collapsed) this.applyCollapsed(handle, true);
  }

  private forget(entry: Entry): void {
    if (entry.boundsTimer !== null) this.timers.clearTimeout(entry.boundsTimer);
    entry.boundsTimer = null;
    if (this.entry === entry) this.entry = null;
  }

  /** Collapsed keeps only the 36 px header (fixed size); expanded restores the stored size. */
  private applyCollapsed(handle: WidgetWindowHandle, collapsed: boolean): void {
    if (collapsed) {
      handle.setMinimumSize(WIDGET_MIN.width, WIDGET_HEADER_PX);
      handle.setContentSize(handle.getContentSize()[0], WIDGET_HEADER_PX);
      handle.setResizable(false);
      return;
    }
    const stored = this.deps.store.get().bounds;
    handle.setMinimumSize(WIDGET_MIN.width, WIDGET_MIN.height);
    handle.setSize(stored?.width ?? WIDGET_DEFAULT.width, stored?.height ?? WIDGET_DEFAULT.height);
    handle.setResizable(true);
  }

  private scheduleBoundsSave(entry: Entry): void {
    if (entry.boundsTimer !== null) this.timers.clearTimeout(entry.boundsTimer);
    entry.boundsTimer = this.timers.setTimeout(() => {
      entry.boundsTimer = null;
      if (!entry.handle.isDestroyed()) this.saveBounds(entry);
    }, this.debounceMs);
  }

  /** Stores the expanded outer bounds; while collapsed only the position changes; no position where unsupported. */
  private saveBounds(entry: Entry): void {
    if (entry.boundsTimer !== null) this.timers.clearTimeout(entry.boundsTimer);
    entry.boundsTimer = null;
    const b = entry.handle.getBounds();
    const current = this.deps.store.get();
    const positioned = this.positioningSupported();
    const size = current.collapsed
      ? { width: current.bounds?.width ?? WIDGET_DEFAULT.width, height: current.bounds?.height ?? WIDGET_DEFAULT.height }
      : { width: Math.max(WIDGET_MIN.width, Math.round(b.width)), height: Math.max(WIDGET_MIN.height, Math.round(b.height)) };
    const bounds: StoredBoundsType = { x: positioned ? Math.round(b.x) : null, y: positioned ? Math.round(b.y) : null, ...size };
    this.deps.store.patch({ bounds, displayId: positioned ? displayFor(b, this.deps.displays.all()) : null });
  }
}
