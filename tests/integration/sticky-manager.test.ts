import { describe, expect, it } from 'vitest';
import type { CapabilitiesType } from '../../src/shared/contracts/app';
import type { StickyStateType } from '../../src/shared/contracts/stickies';
import type { DisplayInfo } from '../../src/main/windows/display-clamp';
import { StickyManager, type StickyLayoutEntry } from '../../src/main/windows/sticky-manager';
import { setupServices, thrown } from './hierarchy-helpers';
import { display, FakeStickyWindow, fakeDisplays, fakeStickyFactory, FRAME, manualTimers, WINDOWS_CAPS, WSLG_CAPS } from './sticky-fakes';

const MISSING = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const settle = () => new Promise((r) => setImmediate(r));

async function setup(opts: { caps?: CapabilitiesType; displays?: DisplayInfo[]; restore?: boolean; maxOpen?: number } = {}) {
  let manager: StickyManager | null = null;
  const s = await setupServices({ onTreeChanged: () => manager?.onTreeChanged() });
  const log: string[] = [];
  const fake = fakeStickyFactory(log);
  const displays = fakeDisplays(opts.displays ?? [display(1, 0)]);
  const timers = manualTimers();
  const sent: Array<{ webContentsId: number; state: StickyStateType }> = [];
  const opened: Array<{ noteId: string }> = [];
  const layout: StickyLayoutEntry[] = [];
  const ctl = { caps: opts.caps ?? WINDOWS_CAPS, restore: opts.restore ?? false, flushGate: null as Deferred | null, saved: true, theme: 'light' as 'light' | 'dark' };
  // The real StickyService, with setOpen recorded in the order log.
  const service = Object.assign(Object.create(s.stickies) as typeof s.stickies, {
    setOpen: (noteId: string, open: boolean) => {
      log.push(`open:${open ? 1 : 0}`);
      s.stickies.setOpen(noteId, open);
    },
  });
  manager = new StickyManager({
    service,
    factory: fake.factory,
    displays,
    caps: () => ctl.caps,
    flush: async (ids) => {
      log.push(`flush:${ids.join(',')}`);
      await ctl.flushGate?.promise;
      return ctl.saved;
    },
    resetViews: (id) => {
      log.push(`reset:${id}`);
      s.collab.webContentsReset(id);
    },
    sendState: (webContentsId, state) => sent.push({ webContentsId, state }),
    trash: s.trash,
    mainWindow: {
      openNote: (noteId) => {
        log.push(`openNote:${noteId}`);
        opened.push({ noteId });
      },
    },
    restoreOnStartupEnabled: () => ctl.restore,
    theme: () => ctl.theme,
    logger: s.logger,
    timers,
    maxOpen: opts.maxOpen,
    onLayout: (e) => layout.push(e),
  });
  const m = manager;
  const stored = (noteId: string) => s.stickies.state(noteId);
  const noteRow = (id: string) => s.row<{ sticky_enabled: number; color: string; deleted_at: number | null }>('SELECT sticky_enabled, color, deleted_at FROM notes WHERE id = ?', id);
  const lastState = (win: FakeStickyWindow) => [...sent].reverse().find((x) => x.webContentsId === win.webContentsId)?.state;
  return { s, m, log, ...fake, displays, timers, sent, opened, layout, ctl, stored, noteRow, lastState };
}

describe('StickyManager float (INF-STKY-01, INF-STKY-11)', () => {
  it('float twice creates once, focuses the existing window and counts activations', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'Groceries');
    expect(await t.m.float(note.id)).toEqual({ noteId: note.id, created: true });
    expect(t.windows).toHaveLength(1);
    const win = t.last();
    expect(win.spec).toMatchObject({ noteId: note.id, title: 'Groceries - Infinity Notes', backgroundColor: '#FFF4B8', alwaysOnTop: false });
    expect(win.spec.placement).toEqual({ x: 1920 - 320 - 32, y: 32, width: 320, height: 300, displayId: 1 });
    expect(win.visible).toBe(false);
    win.events.onReadyToShow();
    expect(win.visible && win.focused).toBe(true);
    expect(t.noteRow(note.id)).toMatchObject({ sticky_enabled: 1, color: 'yellow' });
    expect(t.stored(note.id).open).toBe(true);
    expect(t.m.stateOf(note.id)).toMatchObject({ noteId: note.id, title: 'Groceries', color: 'yellow', path: ['Common'], trashed: null, activation: 1 });

    win.focused = false;
    expect(await t.m.float(note.id)).toEqual({ noteId: note.id, created: false });
    expect(await t.m.float(note.id)).toEqual({ noteId: note.id, created: false });
    expect(t.windows).toHaveLength(1);
    expect(win.focused).toBe(true);
    expect(t.lastState(win)?.activation).toBe(3);
    expect(t.s.logger.lines.filter((l) => l.includes(`sticky: open note=${note.id} created=false`))).toHaveLength(2);
  });

  it('trashed and missing notes create nothing', async () => {
    const t = await setup();
    await expect(t.m.float(MISSING)).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'This note no longer exists' });
    const note = t.s.note(null, null, 'n');
    const { trashBatchId } = t.s.trash.trashNote(note.id);
    await expect(t.m.float(note.id)).rejects.toMatchObject({ code: 'NOT_FOUND', details: { trashed: true, trashBatchId } });
    expect(t.windows).toHaveLength(0);
    expect(t.s.rows('SELECT key FROM window_state')).toEqual([]);
  });

  it('the 51st open sticky is refused and nothing is stored for it; open ones still focus', async () => {
    const t = await setup();
    const notes = Array.from({ length: 51 }, (_, i) => t.s.note(null, null, `n${i}`));
    for (const n of notes.slice(0, 50)) await t.m.float(n.id);
    await expect(t.m.float(notes[50]!.id)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', message: 'You have 50 open stickies. Hide some to open more.' });
    expect(t.windows).toHaveLength(50);
    expect(t.noteRow(notes[50]!.id)?.sticky_enabled).toBe(0);
    expect(await t.m.float(notes[0]!.id)).toEqual({ noteId: notes[0]!.id, created: false });
  });
});

describe('StickyManager hide, dock and remove (INF-STKY-03, INF-STKY-05)', () => {
  it('the OS close hides: flush, open = 0, leases reset, destroy; the note stays a sticky', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n');
    await t.m.float(note.id);
    const win = t.last();
    t.ctl.flushGate = deferred();
    t.log.length = 0;
    expect(win.osClose()).toBe(false);
    expect(win.osClose()).toBe(false);
    await settle();
    expect(win.destroyed).toBe(false);
    expect(t.log).toEqual([`flush:${win.webContentsId}`]);
    t.ctl.flushGate.resolve();
    await settle();
    expect(t.log).toEqual([`flush:${win.webContentsId}`, 'open:0', `reset:${win.webContentsId}`, `destroy:${win.webContentsId}`]);
    expect(t.m.isFloating(note.id)).toBe(false);
    expect(t.noteRow(note.id)).toMatchObject({ sticky_enabled: 1, deleted_at: null });
    expect(t.stored(note.id)).toMatchObject({ open: false, bounds: { x: win.bounds.x, y: win.bounds.y, width: 320, height: 300 } });

    // Reopening creates a fresh window from the stored state.
    await t.m.float(note.id);
    expect(t.windows).toHaveLength(2);
    expect(t.last().spec.placement).toMatchObject({ x: win.bounds.x, y: win.bounds.y, width: 320, height: 300 });
  });

  it('a window whose text is not saved stays open on hide, OS close, dock and remove (D-055, D-072)', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n');
    await t.m.float(note.id);
    const win = t.last();
    t.ctl.saved = false;
    t.log.length = 0;
    expect(win.osClose()).toBe(false);
    await settle();
    expect(t.log).toEqual([`flush:${win.webContentsId}`]);
    expect(win.destroyed).toBe(false);
    expect(t.m.isFloating(note.id)).toBe(true);
    expect(t.stored(note.id).open).toBe(true);
    await expect(t.m.hide(note.id)).rejects.toMatchObject({ code: 'INTERNAL', message: 'Could not save this note. The window stays open.' });
    await expect(t.m.dock(note.id)).rejects.toMatchObject({ code: 'INTERNAL' });
    await expect(t.m.remove(note.id)).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(t.opened).toEqual([]);
    expect(t.noteRow(note.id)?.sticky_enabled).toBe(1);
    expect(win.destroyed).toBe(false);
    expect(t.s.logger.lines.some((l) => l.includes(`sticky: kept open note=${note.id}`))).toBe(true);
    // Once the text is saved the same action goes through.
    t.ctl.saved = true;
    await t.m.dock(note.id);
    expect(win.destroyed).toBe(true);
    expect(t.opened).toEqual([{ noteId: note.id }]);
  });

  it('a canceled quit makes the OS close hide again', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n');
    await t.m.float(note.id);
    t.m.prepareQuit();
    t.m.cancelQuit();
    expect(t.last().osClose()).toBe(false);
    await settle();
    expect(t.last().destroyed).toBe(true);
    expect(t.stored(note.id).open).toBe(false);
  });

  it('a float while a hide is still flushing waits and then opens a new window', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n');
    await t.m.float(note.id);
    t.ctl.flushGate = deferred();
    const hiding = t.m.hide(note.id);
    const floating = t.m.float(note.id);
    t.ctl.flushGate.resolve();
    await hiding;
    expect(await floating).toEqual({ noteId: note.id, created: true });
    expect(t.windows.map((w) => w.destroyed)).toEqual([true, false]);
    expect(t.stored(note.id).open).toBe(true);
  });

  it('dock hides the window first and only then opens the tab with edit control', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n');
    await t.m.float(note.id);
    const win = t.last();
    t.log.length = 0;
    await t.m.dock(note.id);
    expect(t.log).toEqual([`flush:${win.webContentsId}`, 'open:0', `reset:${win.webContentsId}`, `destroy:${win.webContentsId}`, `openNote:${note.id}`]);
    expect(t.opened).toEqual([{ noteId: note.id }]);
    expect(t.noteRow(note.id)?.sticky_enabled).toBe(1);

    t.log.length = 0;
    await t.m.dock(note.id);
    expect(t.log).toEqual([`openNote:${note.id}`]);
    await expect(t.m.dock(MISSING)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('remove from stickies docks and clears the flag and the window state', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n');
    await t.m.float(note.id);
    t.m.setCollapsed(note.id, true);
    await t.m.remove(note.id);
    expect(t.last().destroyed).toBe(true);
    expect(t.noteRow(note.id)?.sticky_enabled).toBe(0);
    expect(t.s.rows('SELECT key FROM window_state')).toEqual([]);
    expect(t.opened).toEqual([{ noteId: note.id }]);
  });
});

describe('StickyManager tree changes (INF-STKY-04, INF-STKY-08)', () => {
  it('renames and moves from elsewhere reach the window; unrelated changes send nothing', async () => {
    const t = await setup();
    const alpha = t.s.project('Alpha');
    const plans = t.s.folder(alpha.id, null, 'Plans');
    const note = t.s.note(null, null, 'Old');
    await t.m.float(note.id);
    const win = t.last();
    t.s.hierarchy.renameNote(note.id, 'New');
    expect(t.lastState(win)).toMatchObject({ title: 'New', path: ['Common'] });
    expect(win.title).toBe('New - Infinity Notes');
    t.s.hierarchy.moveNote(note.id, { projectId: alpha.id, folderId: plans.id });
    expect(t.lastState(win)?.path).toEqual(['Alpha', 'Plans']);
    const count = t.sent.length;
    t.s.note(null, null, 'unrelated');
    expect(t.sent).toHaveLength(count);
  });

  it('trash shows the trash state, restore brings it back, purge closes the window without a flush', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n');
    await t.m.float(note.id);
    const win = t.last();
    expect(thrown(() => t.m.restore(note.id))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'This note is not in Trash' });
    const { trashBatchId } = t.s.trash.trashNote(note.id);
    expect(t.lastState(win)?.trashed).toEqual({ batchId: trashBatchId });
    const res = t.m.restore(note.id);
    expect(res).toMatchObject({ kind: 'note', id: note.id, relocated: false, path: ['Common'] });
    expect(t.lastState(win)?.trashed).toBeNull();
    const again = t.s.trash.trashNote(note.id);
    t.log.length = 0;
    t.s.trash.purge({ target: { kind: 'batch', batchId: again.trashBatchId }, confirmed: true });
    expect(t.log).toEqual([`reset:${win.webContentsId}`, `destroy:${win.webContentsId}`]);
    expect(t.m.isFloating(note.id)).toBe(false);
  });

  it('setColor recolors the window once and answers null when the sticky is not floating', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n', true);
    expect(t.m.setColor(note.id, 'green')).toBeNull();
    await t.m.float(note.id);
    const win = t.last();
    expect(win.spec.backgroundColor).toBe('#DDF5D8');
    const before = t.sent.length;
    expect(t.m.setColor(note.id, 'blue')).toMatchObject({ color: 'blue', activation: 1 });
    expect(win.backgroundColor).toBe('#DCEBFF');
    expect(t.sent.length - before).toBe(1);
  });

  it('a custom color is stored as given and is the window background in both themes (v0.2.0)', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n', true);
    await t.m.float(note.id);
    const win = t.last();
    expect(t.m.setColor(note.id, '#3a7bd5')).toMatchObject({ color: '#3a7bd5', textColor: null });
    expect(t.noteRow(note.id)?.color).toBe('#3a7bd5');
    expect(win.backgroundColor).toBe('#3a7bd5');
    t.ctl.theme = 'dark';
    t.m.themeChanged();
    expect(win.backgroundColor).toBe('#3a7bd5');
  });

  it('the window background follows a theme change for presets (v0.2.0)', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n', true);
    await t.m.float(note.id);
    const win = t.last();
    expect(win.backgroundColor).toBe('#FFF4B8');
    t.ctl.theme = 'dark';
    t.m.themeChanged();
    expect(win.backgroundColor).toBe('#4A4320');
  });

  it('setTextColor stores the default text color, tells the window and answers null when not floating (v0.2.0)', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n', true);
    expect(t.m.setTextColor(note.id, '#e03131')).toBeNull();
    expect(t.s.stickies.meta(note.id)?.textColor).toBe('#e03131');
    await t.m.float(note.id);
    const win = t.last();
    expect(t.lastState(win)?.textColor ?? t.m.stateOf(note.id).textColor).toBe('#e03131');
    const before = t.sent.length;
    expect(t.m.setTextColor(note.id, null)).toMatchObject({ textColor: null });
    expect(t.sent.length - before).toBe(1);
    expect(t.lastState(win)?.textColor).toBeNull();
    expect(t.s.row<{ text_color: string | null }>('SELECT text_color FROM notes WHERE id = ?', note.id)?.text_color).toBeNull();
    const plain = t.s.note(null, null, 'not a sticky');
    expect(() => t.m.setTextColor(plain.id, '#e03131')).toThrow(/not a sticky/);
  });
});

describe('StickyManager header state (INF-STKY-04, INF-STKY-06, INF-STKY-13)', () => {
  it('collapse keeps only the header and a fixed size; expand restores the stored size', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n');
    await t.m.float(note.id);
    const win = t.last();
    win.userMove({ width: 400, height: 350 });
    expect((t.m.setCollapsed(note.id, true)).collapsed).toBe(true);
    expect(win.getContentSize()).toEqual([400 - FRAME.width, 36]);
    expect(win.minSize).toEqual([220, 0]);
    expect(win.resizable).toBe(false);
    expect(t.stored(note.id)).toMatchObject({ collapsed: true, bounds: { width: 400, height: 350 } });

    win.userMove({ x: 50, y: 60 });
    t.timers.advance(500);
    expect(t.stored(note.id).bounds).toEqual({ x: 50, y: 60, width: 400, height: 350 });

    expect((t.m.setCollapsed(note.id, false)).collapsed).toBe(false);
    expect(win.getBounds()).toEqual({ x: 50, y: 60, width: 400, height: 350 });
    expect(win.minSize).toEqual([220, 120]);
    expect(win.resizable).toBe(true);
    expect(t.stored(note.id).collapsed).toBe(false);
  });

  it('pin sets always-on-top where supported and is refused with nothing stored where not', async () => {
    const t = await setup();
    const note = t.s.note(null, null, 'n');
    await t.m.float(note.id);
    const win = t.last();
    expect(t.m.setPinned(note.id, true)).toMatchObject({ alwaysOnTop: true });
    expect(win.alwaysOnTop).toBe(true);
    expect(t.stored(note.id).alwaysOnTop).toBe(true);
    t.m.setPinned(note.id, false);
    expect(win.alwaysOnTop).toBe(false);

    const w = await setup({ caps: WSLG_CAPS });
    const other = w.s.note(null, null, 'n');
    await w.m.float(other.id);
    expect(thrown(() => w.m.setPinned(other.id, true))).toMatchObject({ code: 'UNSUPPORTED', message: 'Not supported by this desktop' });
    expect(w.last().alwaysOnTop).toBe(false);
    expect(w.stored(other.id).alwaysOnTop).toBe(false);
  });

  it('bounds are saved 500 ms after the last move or resize, with the display id', async () => {
    const t = await setup({ displays: [display(1, 0), display(2, 1920)] });
    const note = t.s.note(null, null, 'n');
    await t.m.float(note.id);
    const win = t.last();
    win.userMove({ x: 2000, y: 100 });
    t.timers.advance(300);
    win.userMove({ x: 2100, y: 120, width: 360 });
    t.timers.advance(300);
    expect(t.stored(note.id).bounds).toBeNull();
    t.timers.advance(200);
    expect(t.stored(note.id)).toMatchObject({ bounds: { x: 2100, y: 120, width: 360, height: 300 }, displayId: 2 });
  });

  it('where positioning is unsupported the window opens with a size only and x/y are stored as null', async () => {
    const t = await setup({ caps: WSLG_CAPS });
    const note = t.s.note(null, null, 'n');
    await t.m.float(note.id);
    const win = t.last();
    expect(win.spec.placement).toEqual({ width: 320, height: 300 });
    win.userMove({ x: 700, y: 500, width: 333, height: 444 });
    t.timers.advance(500);
    expect(t.stored(note.id)).toMatchObject({ bounds: { x: null, y: null, width: 333, height: 444 }, displayId: null });
    await t.m.hide(note.id);
    await t.m.float(note.id);
    expect(t.last().spec.placement).toEqual({ width: 333, height: 444 });
  });

  it('a display change re-clamps only the unreachable windows and persists them', async () => {
    const t = await setup({ displays: [display(1, 0), display(2, 1920)] });
    const a = t.s.note(null, null, 'a');
    const b = t.s.note(null, null, 'b');
    await t.m.float(a.id);
    const winA = t.last();
    await t.m.float(b.id);
    const winB = t.last();
    winA.userMove({ x: 2400, y: 100 });
    winB.userMove({ x: 300, y: 200 });
    t.timers.advance(500);
    expect(t.stored(a.id).displayId).toBe(2);
    const bBefore = winB.getBounds();
    t.layout.length = 0;
    t.displays.set([display(1, 0)], 1);
    expect(t.layout.map((e) => e.noteId)).toEqual([a.id]);
    const clamp = t.layout[0]!.bounds;
    expect(winA.getBounds()).toEqual({ x: clamp.x, y: clamp.y, width: 320, height: 300 });
    expect(clamp.x! >= 0 && clamp.x! + 320 <= 1920 && clamp.y! >= 0 && clamp.y! + 300 <= 1040).toBe(true);
    expect(winB.getBounds()).toEqual(bBefore);
    expect(t.stored(a.id)).toMatchObject({ bounds: { x: clamp.x, y: clamp.y }, displayId: 1 });
    expect(t.displays.listenerCount()).toBe(1);
  });
});

describe('StickyManager startup and quit (INF-STKY-09, INF-STKY-12)', () => {
  it('restoreOnStartup only when enabled; trashed rows are closed; windows start inactive without taking control', async () => {
    const t = await setup();
    const a = t.s.note(null, null, 'a');
    const b = t.s.note(null, null, 'b');
    for (const n of [a, b]) await t.m.float(n.id);
    t.s.trash.trashNote(b.id);
    const off = await setup();
    // A second manager on the same database stands for the next app start.
    const next = new StickyManager({ ...managerDepsLike(off), service: t.s.stickies, restoreOnStartupEnabled: () => false });
    next.restoreOnStartup();
    expect(off.windows).toHaveLength(0);
    expect(t.stored(a.id).open).toBe(false);

    t.s.stickies.setOpen(a.id, true);
    t.s.stickies.setOpen(b.id, true);
    const on = await setup();
    const restored = new StickyManager({ ...managerDepsLike(on), service: t.s.stickies, restoreOnStartupEnabled: () => true });
    restored.restoreOnStartup();
    expect(on.windows.map((w) => w.spec.noteId)).toEqual([a.id]);
    on.last().events.onReadyToShow();
    expect(on.log).toContain(`showInactive:${on.last().webContentsId}`);
    expect(restored.stateOf(a.id).activation).toBe(0);
    expect(t.stored(b.id).open).toBe(false);
  });

  it('restored windows are clamped, collapsed and pinned as stored, and shown normally under Wayland', async () => {
    const t = await setup({ restore: true });
    const note = t.s.note(null, null, 'n', true);
    t.s.stickies.saveBounds(note.id, { x: 9000, y: 9000, width: 300, height: 260 }, 7);
    t.s.stickies.setCollapsed(note.id, true);
    t.s.stickies.setAlwaysOnTop(note.id, true);
    t.s.stickies.setOpen(note.id, true);
    t.m.restoreOnStartup();
    const win = t.last();
    expect(win.spec.placement).toEqual({ x: (1920 - 300) / 2, y: (1040 - 260) / 2, width: 300, height: 260, displayId: 1 });
    expect(win.spec.alwaysOnTop).toBe(true);
    expect(win.getContentSize()[1]).toBe(36);
    expect(win.resizable).toBe(false);
    expect(t.stored(note.id).bounds).toEqual({ x: 9000, y: 9000, width: 300, height: 260 });

    const w = await setup({ restore: true, caps: WSLG_CAPS });
    const other = w.s.note(null, null, 'o', true);
    w.s.stickies.setOpen(other.id, true);
    w.m.restoreOnStartup();
    w.last().events.onReadyToShow();
    expect(w.log).toContain(`show:${w.last().webContentsId}`);
  });

  it('quit lets windows close, saves their bounds and keeps open = 1', async () => {
    const t = await setup();
    const a = t.s.note(null, null, 'a');
    await t.m.float(a.id);
    const win = t.last();
    win.userMove({ x: 40, y: 50 });
    t.m.prepareQuit();
    expect(t.stored(a.id)).toMatchObject({ open: true, bounds: { x: 40, y: 50, width: 320, height: 300 } });
    t.log.length = 0;
    expect(win.osClose()).toBe(true);
    expect(t.log).toEqual([`destroy:${win.webContentsId}`]);
    expect(t.stored(a.id).open).toBe(true);
    expect(t.m.isFloating(a.id)).toBe(false);
  });

  it('one display listener for the manager lifetime, whatever the number of windows', async () => {
    const t = await setup();
    const notes = [t.s.note(null, null, 'a'), t.s.note(null, null, 'b')];
    for (let i = 0; i < 3; i += 1) {
      for (const n of notes) await t.m.float(n.id);
      for (const n of notes) await t.m.hide(n.id);
    }
    expect(t.displays.listenerCount()).toBe(1);
    t.m.dispose();
    expect(t.displays.listenerCount()).toBe(0);
  });
});

/** Dependencies of a fresh manager built from another test setup (its own factory, displays and logs). */
function managerDepsLike(t: Awaited<ReturnType<typeof setup>>) {
  return {
    factory: t.factory,
    displays: t.displays,
    caps: () => WINDOWS_CAPS,
    flush: async () => true,
    resetViews: () => {},
    sendState: () => {},
    trash: t.s.trash,
    mainWindow: { openNote: () => {} },
    theme: () => 'light' as const,
    logger: t.s.logger,
    timers: t.timers,
  };
}
