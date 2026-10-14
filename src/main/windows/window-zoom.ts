import { nextZoom, type ZoomAction, type ZoomKind, type ZoomPercent } from '../../shared/zoom';
import type { SettingsService } from '../services/settings-service';

/** The zoom of each kind of window. */
export type ZoomLevels = Record<ZoomKind, ZoomPercent>;

/** Where the levels are kept: the settings, or memory when there is no database. */
export interface ZoomLevelStore {
  read(): ZoomLevels;
  write(levels: ZoomLevels): void;
}

/** What WindowZoom uses of a window's webContents (an adapter over Electron's, or a fake in tests). */
export interface ZoomableContents {
  readonly id: number;
  setZoomFactor(factor: number): void;
  isDestroyed(): boolean;
  /** A page committed or finished loading (a reload starts at 100 % until the level is applied again). */
  onLoad(listener: () => void): void;
  /** Ctrl+mouse wheel the page left unhandled (a viewer that zooms its own content takes it first). */
  onWheelZoom(listener: (direction: 'in' | 'out') => void): void;
  onDestroyed(listener: () => void): void;
}

export interface WindowZoomDeps {
  store: ZoomLevelStore;
  /** Tells a window its new zoom (the title bar's indicator). */
  notify(webContentsId: number, percent: ZoomPercent): void;
}

/**
 * Window zoom (D-186): one level per kind of window (the main window, all stickies together, the widget), kept by main
 * and applied with `setZoomFactor` to every window of the kind. Windows use Chromium's isolated zoom mode (their pages
 * share one origin, whose zoom would otherwise be shared), and a level is applied again whenever a page loads, so it
 * survives reloads. Keys reach main as `window:zoom` from the page; Ctrl+wheel comes as Electron's `zoom-changed`, which
 * fires only for wheel events the page did not take.
 */
export class WindowZoom {
  private readonly windows = new Map<number, { kind: ZoomKind; contents: ZoomableContents }>();

  constructor(private readonly deps: WindowZoomDeps) {}

  percentOf(kind: ZoomKind): ZoomPercent {
    return this.deps.store.read()[kind];
  }

  /** Follows a new window of a kind (before its page loads): its level on every page load, and its Ctrl+wheel. */
  attach(kind: ZoomKind, contents: ZoomableContents): void {
    this.windows.set(contents.id, { kind, contents });
    contents.onLoad(() => this.apply(contents, this.percentOf(kind)));
    contents.onWheelZoom((direction) => this.change(kind, direction));
    contents.onDestroyed(() => this.windows.delete(contents.id));
  }

  /** Zooms every window of the kind; the new level is stored and the windows are told. */
  change(kind: ZoomKind, action: ZoomAction): ZoomPercent {
    const levels = this.deps.store.read();
    const percent = nextZoom(levels[kind], action);
    if (percent !== levels[kind]) this.deps.store.write({ ...levels, [kind]: percent });
    for (const { kind: k, contents } of this.windows.values()) {
      if (k !== kind || contents.isDestroyed()) continue;
      this.apply(contents, percent);
      this.deps.notify(contents.id, percent);
    }
    return percent;
  }

  private apply(contents: ZoomableContents, percent: ZoomPercent): void {
    if (!contents.isDestroyed()) contents.setZoomFactor(percent / 100);
  }
}

/** Levels kept in the main-only setting `window.zoom`. */
export function settingsZoomStore(settings: Pick<SettingsService, 'getInternal' | 'setInternal'>): ZoomLevelStore {
  return { read: () => settings.getInternal('window.zoom'), write: (levels) => settings.setInternal('window.zoom', levels) };
}

/** Levels kept only while the app runs (no database). */
export function memoryZoomStore(initial: ZoomLevels = { main: 100, sticky: 100, widget: 100 }): ZoomLevelStore {
  let levels = initial;
  return {
    read: () => levels,
    write: (next) => {
      levels = next;
    },
  };
}
