import { describe, expect, it } from 'vitest';
import type { CapabilitiesType } from '../../src/shared/contracts/app';
import type { WidgetStateType } from '../../src/shared/contracts/widget';
import { WidgetManager } from '../../src/main/windows/widget-manager';
import { setupServices, thrown } from './hierarchy-helpers';
import { FRAME, fakeDisplays, fakeWidgetFactory, manualTimers, WINDOWS_CAPS, WSLG_CAPS } from './sticky-fakes';

async function setup(caps: CapabilitiesType = WINDOWS_CAPS) {
  const s = await setupServices();
  const log: string[] = [];
  const fake = fakeWidgetFactory(log);
  const timers = manualTimers();
  const emitted: Array<{ state: WidgetStateType; to: number | null }> = [];
  // Records the order of stored changes next to the window calls.
  const store = {
    get: () => s.widgetState.get(),
    patch: (p: Parameters<typeof s.widgetState.patch>[0]) => {
      log.push(`patch:${Object.keys(p).join(',')}`);
      s.widgetState.patch(p);
    },
  };
  const make = () =>
    new WidgetManager({ store, factory: fake.factory, displays: fakeDisplays(), caps: () => caps, emitState: (state, to) => emitted.push({ state, to }), logger: s.logger, timers });
  const row = () => s.row<{ bounds: string | null; open: number; collapsed: number; always_on_top: number; note_id: string | null }>("SELECT bounds, open, collapsed, always_on_top, note_id FROM window_state WHERE key = 'widget'");
  return { s, log, fake, timers, emitted, make, m: make(), row };
}

describe('WidgetManager (INF-WIDG-01..03, D-081)', () => {
  it('default off: no row and nothing restored; show twice creates one window', async () => {
    const t = await setup();
    t.m.restoreOnStartup();
    expect(t.fake.windows).toHaveLength(0);
    expect(t.row()).toBeUndefined();
    expect(t.m.state()).toEqual({ open: false, collapsed: false, alwaysOnTop: false });
    expect(t.m.show()).toEqual({ open: true, collapsed: false, alwaysOnTop: false });
    t.fake.last().events.onReadyToShow();
    t.m.show();
    expect(t.fake.windows).toHaveLength(1);
    expect(t.log.filter((l) => l === 'create:widget')).toHaveLength(1);
    expect(t.fake.last().visible).toBe(true);
    expect(t.fake.last().bounds).toMatchObject({ width: 300, height: 420 });
    expect(t.row()).toMatchObject({ open: 1, note_id: null });
    expect(t.emitted.at(-1)).toEqual({ state: { open: true, collapsed: false, alwaysOnTop: false }, to: t.fake.last().webContentsId });
  });

  it('hide saves the bounds, then stores open = 0, then destroys the window; the OS close hides too', async () => {
    const t = await setup();
    t.m.show();
    t.fake.last().userMove({ x: 50, y: 60, width: 280, height: 400 });
    t.log.length = 0;
    expect(t.m.hide()).toEqual({ open: false, collapsed: false, alwaysOnTop: false });
    expect(t.log).toEqual(['patch:bounds,displayId', 'patch:open', 'destroy:500']);
    expect(t.row()).toMatchObject({ open: 0 });
    expect(JSON.parse(t.row()!.bounds!)).toEqual({ x: 50, y: 60, width: 280, height: 400 });
    expect(t.emitted.at(-1)).toEqual({ state: { open: false, collapsed: false, alwaysOnTop: false }, to: null });
    t.m.show();
    expect(t.fake.last().bounds).toMatchObject({ x: 50, y: 60, width: 280, height: 400 });
    expect(t.fake.last().osClose()).toBe(false);
    expect(t.fake.last().destroyed).toBe(true);
    expect(t.row()!.open).toBe(0);
  });

  it('collapse keeps the 36 px header, fixed; expand restores the stored size', async () => {
    const t = await setup();
    t.m.show();
    const win = t.fake.last();
    win.userMove({ width: 320, height: 440 });
    expect(t.m.setCollapsed(true)).toEqual({ open: true, collapsed: true, alwaysOnTop: false });
    expect(win.getContentSize()[1]).toBe(36);
    expect(win.resizable).toBe(false);
    expect(win.minSize).toEqual([240, 36]);
    expect(t.row()!.collapsed).toBe(1);
    expect(t.m.setCollapsed(false).collapsed).toBe(false);
    expect(win.bounds).toMatchObject({ width: 320, height: 440 });
    expect(win.resizable).toBe(true);
    expect(win.minSize).toEqual([240, 160]);
    expect(win.getContentSize()[1]).toBe(440 - FRAME.height);
  });

  it('keep on top where supported; refused and not stored where unsupported', async () => {
    const t = await setup();
    t.m.show();
    expect(t.m.setPinned(true).alwaysOnTop).toBe(true);
    expect(t.fake.last().alwaysOnTop).toBe(true);
    expect(t.row()!.always_on_top).toBe(1);
    const w = await setup(WSLG_CAPS);
    w.m.show();
    expect(thrown(() => w.m.setPinned(true))).toMatchObject({ code: 'UNSUPPORTED', message: 'Not supported by this desktop' });
    expect(w.row()!.always_on_top).toBe(0);
    expect(w.fake.last().alwaysOnTop).toBe(false);
  });

  it('a widget open at quit comes back at the next start, inactive and collapsed as it was; quitting keeps open = 1', async () => {
    const t = await setup();
    t.m.show();
    t.m.setCollapsed(true);
    t.m.prepareQuit();
    expect(t.fake.last().osClose()).toBe(true);
    expect(t.row()).toMatchObject({ open: 1, collapsed: 1 });
    const next = t.make();
    next.restoreOnStartup();
    expect(t.fake.windows).toHaveLength(2);
    t.fake.last().events.onReadyToShow();
    expect(t.log.at(-1)).toBe('showInactive:501');
    expect(t.fake.last().getContentSize()[1]).toBe(36);
    expect(next.state()).toEqual({ open: true, collapsed: true, alwaysOnTop: false });
  });

  it('moves and resizes are saved 500 ms after they stop', async () => {
    const t = await setup();
    t.m.show();
    t.fake.last().userMove({ x: 10, y: 20 });
    t.timers.advance(499);
    expect(t.row()!.bounds).toBeNull();
    t.timers.advance(1);
    expect(JSON.parse(t.row()!.bounds!)).toMatchObject({ x: 10, y: 20 });
  });
});
