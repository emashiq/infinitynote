import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;
const created: Array<{ options: unknown; calls: string[]; emit(event: string, ...args: unknown[]): void; url: string }> = [];

vi.mock('electron', () => ({
  BrowserWindow: class {
    readonly calls: string[] = [];
    readonly listeners = new Map<string, Listener[]>();
    readonly webContents = { id: 42 + created.length, on: () => undefined, send: () => undefined, isDestroyed: () => false, reload: () => undefined, getURL: () => '' };
    constructor(options: unknown) {
      const emit = (event: string, ...args: unknown[]) => {
        for (const cb of this.listeners.get(event) ?? []) cb(...args);
      };
      created.push({ options, calls: this.calls, emit, url: '' });
    }
    removeMenu() {
      this.calls.push('removeMenu');
    }
    on(event: string, cb: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
      return this;
    }
    once(event: string, cb: Listener) {
      return this.on(event, cb);
    }
    isDestroyed() {
      return false;
    }
    loadURL(url: string) {
      created[created.length - 1]!.url = url;
      return Promise.resolve();
    }
  },
}));

const { stickyWindowOptions, createStickyWindowFactory } = await import('../../src/main/windows/sticky-window');
const { mainWindowOptions } = await import('../../src/main/windows/main-window');
const { secureWebPreferences } = await import('../../src/main/windows/secure-window');
const { WindowRegistry } = await import('../../src/main/windows/window-registry');
const { nullLogger } = await import('../../src/main/services/logger');

const NOTE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const base = { noteId: NOTE, alwaysOnTop: false, backgroundColor: '#FFF4B8', title: 'Groceries - Infinity Notes', preloadPath: '/p/preload.js', iconPath: '/i/icon.png' };

describe('stickyWindowOptions (INF-FND-03, D-070)', () => {
  beforeEach(() => {
    created.length = 0;
  });

  it('uses exactly the main window web preferences', () => {
    const sticky = stickyWindowOptions({ ...base, placement: { width: 320, height: 300 } });
    expect(sticky.webPreferences).toEqual(mainWindowOptions({ preloadPath: '/p/preload.js', iconPath: '/i/icon.png' }).webPreferences);
    expect(sticky.webPreferences).toEqual(secureWebPreferences('/p/preload.js'));
    expect(sticky.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false });
  });

  it('frameless (the header is the title bar, D-097), hidden until ready, minimum 220x120, title and sticky background', () => {
    const o = stickyWindowOptions({ ...base, placement: { width: 320, height: 300 }, platform: 'win32' });
    expect(o.frame).toBe(false);
    expect(o).not.toHaveProperty('titleBarStyle');
    expect(o).not.toHaveProperty('transparent');
    expect(o).toMatchObject({ width: 320, height: 300, minWidth: 220, minHeight: 120, show: false, title: 'Groceries - Infinity Notes', backgroundColor: '#FFF4B8', fullscreenable: false });
    expect(o).not.toHaveProperty('icon');
    expect(stickyWindowOptions({ ...base, placement: { width: 320, height: 300 }, platform: 'linux' }).icon).toBe('/i/icon.png');
  });

  it('a position only when computed; always-on-top only when allowed', () => {
    const sizeOnly = stickyWindowOptions({ ...base, placement: { width: 300, height: 200 } });
    expect(sizeOnly).not.toHaveProperty('x');
    expect(sizeOnly).not.toHaveProperty('y');
    expect(sizeOnly).not.toHaveProperty('alwaysOnTop');
    const placed = stickyWindowOptions({ ...base, alwaysOnTop: true, placement: { x: -1500, y: 40, width: 300, height: 200, displayId: 3 } });
    expect(placed).toMatchObject({ x: -1500, y: 40, alwaysOnTop: true });
  });

  it('the factory removes the menu, registers the sticky role before loading, and loads its own route', () => {
    const registry = new WindowRegistry();
    const factory = createStickyWindowFactory({
      preloadPath: '/p/preload.js',
      iconPath: '/i/icon.png',
      registry,
      logger: nullLogger,
      devUrl: null,
      windowHooks: () => ({ onRendererGone: () => undefined, onNavigated: () => undefined, onSessionEnd: () => undefined }),
    });
    const events = { onReadyToShow: vi.fn(), onClose: vi.fn(), onClosed: vi.fn(), onBoundsChanged: vi.fn() };
    const handle = factory.create({ ...base, placement: { width: 320, height: 300 } }, events);
    const win = created[0]!;
    expect(win.calls).toEqual(['removeMenu']);
    expect(registry.info(handle.webContentsId)).toEqual({ role: 'sticky', noteId: NOTE });
    expect(win.url).toBe(`infinity-app://renderer/index.html#/sticky/${NOTE}`);
    win.emit('move');
    win.emit('resize');
    expect(events.onBoundsChanged).toHaveBeenCalledTimes(2);
    const prevent = vi.fn();
    win.emit('page-title-updated', { preventDefault: prevent });
    expect(prevent).toHaveBeenCalled();
    win.emit('closed');
    expect(registry.has(handle.webContentsId)).toBe(false);
    expect(events.onClosed).toHaveBeenCalled();
  });
});
