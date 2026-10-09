import { detectCapabilities, type CapabilityInputs } from '../../src/main/services/capabilities';
import type { DisplayInfo, Rect } from '../../src/main/windows/display-clamp';
import { createFakeDisplayProvider } from '../../src/main/windows/display-provider';
import type { StickyTimers, StickyWindowEvents, StickyWindowFactory, StickyWindowHandle, StickyWindowSpec } from '../../src/main/windows/sticky-manager';
import type { WidgetWindowFactory } from '../../src/main/windows/widget-manager';
import { WIDGET_TITLE } from '../../src/shared/contracts/widget';

/** Frame added around the content by the fake window manager. */
export const FRAME = { width: 16, height: 39 };

const inputs: CapabilityInputs = {
  platform: 'win32',
  isPackaged: false,
  ozonePlatform: null,
  xdgSessionType: null,
  waylandDisplay: null,
  display: null,
  wslDistro: null,
  wslgVersion: null,
  statusNotifierHost: null,
  notificationServer: null,
};
export const WINDOWS_CAPS = detectCapabilities(inputs);
export const WSLG_CAPS = detectCapabilities({ ...inputs, platform: 'linux', wslDistro: 'Ubuntu', wslgVersion: 'WSLg 1.0.73', statusNotifierHost: 'absent' });

export const display = (id: number, x: number, width = 1920, height = 1080): DisplayInfo => ({
  id,
  bounds: { x, y: 0, width, height },
  workArea: { x, y: 0, width, height: height - 40 },
});

/** A window that behaves like the probes showed: programmatic moves and resizes emit bounds events. */
export class FakeStickyWindow implements StickyWindowHandle {
  bounds: Rect;
  minSize: [number, number] = [220, 120];
  resizable = true;
  alwaysOnTop: boolean;
  visible = false;
  focused = false;
  destroyed = false;
  backgroundColor: string;
  title: string;

  constructor(
    readonly webContentsId: number,
    readonly spec: StickyWindowSpec,
    readonly events: StickyWindowEvents,
    private readonly log: string[],
  ) {
    const p = spec.placement;
    this.bounds = { x: p.x ?? 100, y: p.y ?? 100, width: p.width, height: p.height };
    this.alwaysOnTop = spec.alwaysOnTop;
    this.backgroundColor = spec.backgroundColor;
    this.title = spec.title;
  }

  show(): void {
    this.visible = true;
    this.focused = true;
    this.log.push(`show:${this.webContentsId}`);
  }
  showInactive(): void {
    this.visible = true;
    this.log.push(`showInactive:${this.webContentsId}`);
  }
  focus(): void {
    this.focused = true;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.log.push(`destroy:${this.webContentsId}`);
    this.events.onClosed();
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  getBounds(): Rect {
    return { ...this.bounds };
  }
  setBounds(b: Rect): void {
    this.bounds = { ...b };
    this.events.onBoundsChanged();
  }
  setSize(width: number, height: number): void {
    this.bounds = { ...this.bounds, width, height };
    this.events.onBoundsChanged();
  }
  getContentSize(): [number, number] {
    return [this.bounds.width - FRAME.width, this.bounds.height - FRAME.height];
  }
  setContentSize(width: number, height: number): void {
    this.bounds = { ...this.bounds, width: width + FRAME.width, height: height + FRAME.height };
    this.events.onBoundsChanged();
  }
  setMinimumSize(width: number, height: number): void {
    this.minSize = [width, height];
  }
  setResizable(resizable: boolean): void {
    this.resizable = resizable;
  }
  setAlwaysOnTop(on: boolean): void {
    this.alwaysOnTop = on;
  }
  setBackgroundColor(color: string): void {
    this.backgroundColor = color;
  }
  setTitle(title: string): void {
    this.title = title;
  }

  /** The user (or BrowserWindow.close()) closes the window. */
  osClose(): boolean {
    let prevented = false;
    this.events.onClose({ preventDefault: () => (prevented = true) });
    if (!prevented) this.destroy();
    return !prevented;
  }
  /** The user drags or resizes the window. */
  userMove(b: Partial<Rect>): void {
    this.setBounds({ ...this.bounds, ...b });
  }
}

export function fakeStickyFactory(log: string[]) {
  const windows: FakeStickyWindow[] = [];
  let nextId = 100;
  const factory: StickyWindowFactory = {
    create(spec, events) {
      const win = new FakeStickyWindow(nextId++, spec, events, log);
      windows.push(win);
      log.push(`create:${spec.noteId}`);
      return win;
    },
  };
  return { factory, windows, last: () => windows[windows.length - 1]! };
}

/** Timers that only run when the test advances them. */
export function manualTimers(): StickyTimers & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let seq = 0;
  const queue = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn, ms) {
      seq += 1;
      queue.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout(h) {
      queue.delete(h as number);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now) continue;
        queue.delete(id);
        t.fn();
      }
    },
    pending: () => queue.size,
  };
}

export function fakeDisplays(displays: DisplayInfo[] = [display(1, 0)], primaryId = 1) {
  return createFakeDisplayProvider({ displays, primaryId });
}

/** Widget windows built from the same fake window (the widget handle is a subset of the sticky one). */
export function fakeWidgetFactory(log: string[]) {
  const windows: FakeStickyWindow[] = [];
  let nextId = 500;
  const factory: WidgetWindowFactory = {
    create(spec, events) {
      const win = new FakeStickyWindow(nextId++, { noteId: 'widget', placement: spec.placement, alwaysOnTop: spec.alwaysOnTop, backgroundColor: '', title: WIDGET_TITLE }, events, log);
      windows.push(win);
      log.push('create:widget');
      return win;
    },
  };
  return { factory, windows, last: () => windows[windows.length - 1]! };
}
