import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;
const created: Array<{ options: unknown; calls: string[]; emit(event: string, ...args: unknown[]): void; url: string }> = [];

vi.mock('electron', () => ({
  BrowserWindow: class {
    readonly calls: string[] = [];
    readonly listeners = new Map<string, Listener[]>();
    readonly webContents = { id: 77 + created.length, on: () => undefined, send: () => undefined, isDestroyed: () => false, reload: () => undefined, getURL: () => '' };
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

const { widgetWindowOptions, createWidgetWindowFactory } = await import('../../src/main/windows/widget-window');
const { secureWebPreferences } = await import('../../src/main/windows/secure-window');
const { WindowRegistry } = await import('../../src/main/windows/window-registry');
const { nullLogger } = await import('../../src/main/services/logger');

const base = { alwaysOnTop: false, preloadPath: '/p/preload.js', iconPath: '/i/icon.png' };

describe('widgetWindowOptions (INF-FND-03, D-081)', () => {
  beforeEach(() => {
    created.length = 0;
  });

  it('the shared hardened preferences, frameless (D-097), 300x420 default size and a 240x160 minimum', () => {
    const o = widgetWindowOptions({ ...base, placement: { width: 300, height: 420 }, platform: 'win32' });
    expect(o.webPreferences).toEqual(secureWebPreferences('/p/preload.js'));
    expect(o.frame).toBe(false);
    expect(o).not.toHaveProperty('titleBarStyle');
    expect(o).not.toHaveProperty('transparent');
    expect(o).toMatchObject({ width: 300, height: 420, minWidth: 240, minHeight: 160, show: false, title: 'Reminders - Infinity Notes', fullscreenable: false });
    expect(o).not.toHaveProperty('icon');
    expect(widgetWindowOptions({ ...base, placement: { width: 300, height: 420 }, platform: 'linux' }).icon).toBe('/i/icon.png');
  });

  it('a position only when computed; keep-on-top only when allowed', () => {
    const sizeOnly = widgetWindowOptions({ ...base, placement: { width: 300, height: 420 } });
    expect(sizeOnly).not.toHaveProperty('x');
    expect(sizeOnly).not.toHaveProperty('alwaysOnTop');
    expect(widgetWindowOptions({ ...base, alwaysOnTop: true, placement: { x: 10, y: 20, width: 300, height: 420 } })).toMatchObject({ x: 10, y: 20, alwaysOnTop: true });
  });

  it('the factory removes the menu, registers the widget role before loading and loads #/widget', () => {
    const registry = new WindowRegistry();
    const factory = createWidgetWindowFactory({
      preloadPath: '/p/preload.js',
      iconPath: '/i/icon.png',
      registry,
      logger: nullLogger,
      devUrl: null,
      windowHooks: () => ({ onRendererGone: () => undefined, onNavigated: () => undefined, onSessionEnd: () => undefined }),
    });
    const events = { onReadyToShow: vi.fn(), onClose: vi.fn(), onClosed: vi.fn(), onBoundsChanged: vi.fn() };
    const handle = factory.create({ placement: { width: 300, height: 420 }, alwaysOnTop: false }, events);
    const win = created[0]!;
    expect(win.calls).toEqual(['removeMenu']);
    expect(registry.info(handle.webContentsId)).toEqual({ role: 'widget' });
    expect(registry.widget()?.webContentsId).toBe(handle.webContentsId);
    expect(win.url).toBe('infinity-app://renderer/index.html#/widget');
    win.emit('move');
    win.emit('resize');
    expect(events.onBoundsChanged).toHaveBeenCalledTimes(2);
    win.emit('closed');
    expect(registry.has(handle.webContentsId)).toBe(false);
  });
});
