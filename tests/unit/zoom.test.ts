import { describe, expect, it } from 'vitest';
import { memoryZoomStore, WindowZoom, type ZoomableContents, type ZoomLevels } from '../../src/main/windows/window-zoom';
import { createWheelStepper, zoomActionOf } from '../../src/renderer/zoom/zoom-input';
import type { KeyLike } from '../../src/renderer/state/shortcuts';
import { nextZoom, stepLevel, ZOOM_PERCENTS, type ZoomKind } from '../../src/shared/zoom';

describe('zoom steps (D-186)', () => {
  it('are the browser steps from 50 to 300 percent', () => {
    expect([...ZOOM_PERCENTS]).toEqual([50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300]);
  });

  it('step one level in and out, stop at the ends and reset to 100 %', () => {
    expect(nextZoom(100, 'in')).toBe(110);
    expect(nextZoom(110, 'in')).toBe(125);
    expect(nextZoom(100, 'out')).toBe(90);
    expect(nextZoom(67, 'out')).toBe(50);
    expect(nextZoom(300, 'in')).toBe(300);
    expect(nextZoom(50, 'out')).toBe(50);
    expect(nextZoom(250, 'reset')).toBe(100);
  });

  it('step from a value between levels, as a viewer fitted to its pane is', () => {
    expect(stepLevel([0.5, 0.75, 1, 1.5, 2], 0.62, 1)).toBe(0.75);
    expect(stepLevel([0.5, 0.75, 1, 1.5, 2], 0.62, -1)).toBe(0.5);
    expect(stepLevel([0.5, 0.75, 1, 1.5, 2], 0.3, -1)).toBe(0.5);
    expect(stepLevel([0.5, 0.75, 1, 1.5, 2], 2.4, 1)).toBe(2);
  });
});

describe('zoom keys and the wheel (D-186)', () => {
  const key = (k: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, code, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, ...mods });

  it('reads Ctrl+=, Ctrl++, Ctrl+-, Ctrl+0 and the numpad keys', () => {
    expect(zoomActionOf(key('=', 'Equal'))).toBe('in');
    expect(zoomActionOf(key('+', 'Equal', { shiftKey: true }))).toBe('in');
    expect(zoomActionOf(key('+', 'NumpadAdd'))).toBe('in');
    expect(zoomActionOf(key('-', 'Minus'))).toBe('out');
    expect(zoomActionOf(key('-', 'NumpadSubtract'))).toBe('out');
    expect(zoomActionOf(key('0', 'Digit0'))).toBe('reset');
    expect(zoomActionOf(key('0', 'Numpad0'))).toBe('reset');
    // German layout: "=" is Shift+0, and zooms in.
    expect(zoomActionOf(key('=', 'Digit0', { shiftKey: true }))).toBe('in');
  });

  it('leaves other keys alone: no Ctrl, Alt (AltGr) or Meta, and the editor shortcuts', () => {
    expect(zoomActionOf(key('=', 'Equal', { ctrlKey: false }))).toBeNull();
    expect(zoomActionOf(key('=', 'Equal', { altKey: true }))).toBeNull();
    expect(zoomActionOf(key('0', 'Digit0', { metaKey: true }))).toBeNull();
    expect(zoomActionOf(key(')', 'Digit0', { shiftKey: true }))).toBeNull();
    for (const [k, code] of [['7', 'Digit7'], ['b', 'KeyB'], ['k', 'KeyK'], ['/', 'Slash'], ['\\', 'Backslash']]) expect(zoomActionOf(key(k!, code!)), k).toBeNull();
  });

  it('turns a wheel notch into one step and a touchpad gesture into a step per 100 px', () => {
    const step = createWheelStepper();
    expect(step({ deltaY: -100, deltaMode: 0, timeStamp: 0 })).toBe(1);
    expect(step({ deltaY: 100, deltaMode: 0, timeStamp: 1000 })).toBe(-1);
    const pad = createWheelStepper();
    const deltas = [-4, -10, -30, -30, -30, -30, -20];
    expect(deltas.map((deltaY, i) => pad({ deltaY, deltaMode: 0, timeStamp: 16 * i }))).toEqual([1, 0, 0, 0, 1, 0, 0]);
    // Lines count 40 px.
    expect(createWheelStepper()({ deltaY: 3, deltaMode: 1, timeStamp: 0 })).toBe(-1);
    expect(createWheelStepper()({ deltaY: 0, deltaMode: 0, timeStamp: 0 })).toBe(0);
  });
});

/** A window's webContents as WindowZoom sees it, recording what it was told. */
function fakeContents(id: number) {
  const listeners: { load: Array<() => void>; wheel: Array<(d: 'in' | 'out') => void>; destroyed: Array<() => void> } = { load: [], wheel: [], destroyed: [] };
  const state = { factor: 1, destroyed: false };
  const contents: ZoomableContents = {
    id,
    setZoomFactor: (f) => (state.factor = f),
    isDestroyed: () => state.destroyed,
    onLoad: (l) => listeners.load.push(l),
    onWheelZoom: (l) => listeners.wheel.push(l),
    onDestroyed: (l) => listeners.destroyed.push(l),
  };
  return {
    contents,
    state,
    load: () => listeners.load.forEach((l) => l()),
    wheel: (d: 'in' | 'out') => listeners.wheel.forEach((l) => l(d)),
    destroy: () => {
      state.destroyed = true;
      listeners.destroyed.forEach((l) => l());
    },
  };
}

describe('WindowZoom in main (D-186)', () => {
  const setup = (initial: ZoomLevels = { main: 100, sticky: 100, widget: 100 }) => {
    const store = memoryZoomStore(initial);
    const told: Array<[number, number]> = [];
    const zoom = new WindowZoom({ store, notify: (id, percent) => told.push([id, percent]) });
    const attach = (kind: ZoomKind, id: number) => {
      const w = fakeContents(id);
      zoom.attach(kind, w.contents);
      return w;
    };
    return { store, told, zoom, attach };
  };

  it('applies the kind’s level on every page load, so it survives reloads and restarts', () => {
    const { attach } = setup({ main: 125, sticky: 90, widget: 100 });
    const main = attach('main', 1);
    const sticky = attach('sticky', 2);
    expect(main.state.factor).toBe(1);
    main.load();
    sticky.load();
    expect([main.state.factor, sticky.state.factor]).toEqual([1.25, 0.9]);
    main.state.factor = 1;
    main.load();
    expect(main.state.factor).toBe(1.25);
  });

  it('zooms every window of a kind, stores the level and tells those windows only', () => {
    const { zoom, attach, store, told } = setup();
    const main = attach('main', 1);
    const first = attach('sticky', 2);
    const second = attach('sticky', 3);
    expect(zoom.change('sticky', 'in')).toBe(110);
    expect([first.state.factor, second.state.factor, main.state.factor]).toEqual([1.1, 1.1, 1]);
    expect(store.read()).toEqual({ main: 100, sticky: 110, widget: 100 });
    expect(told).toEqual([
      [2, 110],
      [3, 110],
    ]);
    expect(zoom.change('sticky', 'reset')).toBe(100);
    expect(zoom.percentOf('sticky')).toBe(100);
  });

  it('takes Ctrl+wheel the page left unhandled, and forgets closed windows', () => {
    const { zoom, attach } = setup();
    const main = attach('main', 1);
    main.wheel('in');
    main.wheel('in');
    expect(zoom.percentOf('main')).toBe(125);
    expect(main.state.factor).toBe(1.25);
    main.wheel('out');
    expect(zoom.percentOf('main')).toBe(110);
    main.destroy();
    main.state.factor = 0;
    zoom.change('main', 'in');
    expect(main.state.factor).toBe(0);
  });
});
