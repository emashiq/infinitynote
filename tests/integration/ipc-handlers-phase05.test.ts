import { describe, expect, it } from 'vitest';
import type { CapabilityStatusType } from '../../src/shared/contracts/app';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { createAutostartControl } from '../../src/main/services/autostart';
import { WidgetManager } from '../../src/main/windows/widget-manager';
import { catalogueRouter, NO_DESKTOP } from './ipc-helpers';
import { T0, doc, para, reminderInput, setupReminders, updateRequest } from './reminder-helpers';
import { fakeDisplays, fakeWidgetFactory, manualTimers, WINDOWS_CAPS } from './sticky-fakes';

const MAIN = 1;
const STICKY = 3;
const B = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';

const app: AppHandlerDeps = {
  getInfo: () => {
    throw new Error('not used');
  },
  getCapabilities: () => {
    throw new Error('not used');
  },
  shell: { openPath: async () => '', openExternal: async () => {} },
  dataDir: '/data',
  quit: () => {},
  flushed: () => false,
};

/** Every catalogue channel over the real services; window 3 is the sticky window of `own`. */
async function setup() {
  const s = await setupReminders();
  const own = s.editable('Own');
  own.save(doc(para(B, 'Pay rent')));
  const other = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Other').note;
  const opened: Array<{ noteId: string; blockId: string | null }> = [];
  const r = catalogueRouter(s.services, app, {
    stickyNoteId: own.note.id,
    desktop: { ...NO_DESKTOP, mainWindow: { ...NO_DESKTOP.mainWindow, openNote: (noteId, _take, blockId) => opened.push({ noteId, blockId: blockId ?? null }) } },
  });
  return { s, own: own.note, other, opened, call: r.call };
}

describe('Phase 05 reminder channels (D-074)', () => {
  it('main: create, list, views, summary, done, snooze, delete and undo through the catalogue with response validation', async () => {
    const t = await setup();
    const zones = await t.call('zones:list', {}, MAIN);
    expect(zones).toMatchObject({ ok: true, data: { systemZone: 'Asia/Dhaka', defaultZone: 'Asia/Dhaka', asOf: T0 } });
    const created = await t.call('reminder:create', reminderInput(t.own.id, { blockId: B, date: '2026-10-08', time: '15:00' }), MAIN);
    expect(created).toMatchObject({ ok: true, data: { blockId: B, current: { state: 'pending' } } });
    const id = created.data.id as string;
    const occ = created.data.current.occurrenceId as string;
    expect((await t.call('reminder:listForNote', { noteId: t.own.id }, MAIN)).data.reminders).toHaveLength(1);
    expect((await t.call('reminders:listView', { view: 'today' }, MAIN)).data.counts).toEqual({ today: 1, upcoming: 0, overdue: 0 });
    expect((await t.call('reminders:summary', { scope: { kind: 'all' } }, MAIN)).data.todayTotal).toBe(1);
    expect(await t.call('occurrence:snooze', { occurrenceId: occ, preset: 10 }, MAIN)).toEqual({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'This reminder is not due yet' },
    });
    expect((await t.call('occurrence:complete', { occurrenceId: occ }, MAIN)).data.state).toBe('completed');
    const updated = await t.call('reminder:update', updateRequest(id, 1, { title: 'Renamed', blockId: B, date: '2026-10-08', time: '15:00' }), MAIN);
    expect(updated.error).toBeUndefined();
    expect(updated.data).toMatchObject({ title: 'Renamed', revision: 2 });
    expect((await t.call('reminder:update', updateRequest(id, 1), MAIN)).error).toEqual({
      code: 'CONFLICT',
      message: 'This reminder changed elsewhere. Reopen it to edit.',
      details: { currentRevision: 2 },
    });
    expect((await t.call('reminder:delete', { reminderId: id }, MAIN)).data).toEqual({ reminderId: id, undoUntil: T0 + 10_000 });
    expect((await t.call('reminder:undoDelete', { reminderId: id }, MAIN)).data.id).toBe(id);
    expect(await t.call('reminder:open', { reminderId: id }, MAIN)).toEqual({ ok: true, data: {} });
    expect(t.opened).toEqual([{ noteId: t.own.id, blockId: B }]);
  });

  it('requests are validated: unknown zones by name, malformed ids and extra keys by schema', async () => {
    const t = await setup();
    expect((await t.call('reminder:create', reminderInput(t.own.id, { zoneId: 'EST' }), MAIN)).error).toEqual({ code: 'VALIDATION_FAILED', message: 'Choose a time zone from the list' });
    expect((await t.call('reminder:create', { ...reminderInput(t.own.id), extra: 1 }, MAIN)).error?.code).toBe('VALIDATION_FAILED');
    expect((await t.call('occurrence:complete', { occurrenceId: 'nope' }, MAIN)).error?.code).toBe('VALIDATION_FAILED');
    expect((await t.call('reminders:listView', { view: 'later' }, MAIN)).error?.code).toBe('VALIDATION_FAILED');
  });

  it('a sticky lists and opens only its own note’s reminders; every other reminder channel is forbidden to it', async () => {
    const t = await setup();
    const mine = (await t.call('reminder:create', reminderInput(t.own.id), MAIN)).data;
    const theirs = (await t.call('reminder:create', reminderInput(t.other.id), MAIN)).data;
    expect((await t.call('reminder:listForNote', { noteId: t.own.id }, STICKY)).data.reminders.map((r: { id: string }) => r.id)).toEqual([mine.id]);
    expect(await t.call('reminder:listForNote', { noteId: t.other.id }, STICKY)).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    expect(await t.call('reminder:open', { reminderId: mine.id }, STICKY)).toEqual({ ok: true, data: {} });
    expect(await t.call('reminder:open', { reminderId: theirs.id }, STICKY)).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    expect(t.opened).toEqual([{ noteId: t.own.id, blockId: null }]);
    const forbidden: Array<[string, unknown]> = [
      ['zones:list', {}],
      ['reminder:create', reminderInput(t.own.id)],
      ['reminder:update', updateRequest(mine.id, 1)],
      ['reminder:delete', { reminderId: mine.id }],
      ['reminder:undoDelete', { reminderId: mine.id }],
      ['reminders:listView', { view: 'today' }],
      ['reminders:summary', { scope: { kind: 'all' } }],
      ['occurrence:complete', { occurrenceId: mine.current.occurrenceId }],
      ['occurrence:snooze', { occurrenceId: mine.current.occurrenceId, preset: 5 }],
    ];
    for (const [channel, payload] of forbidden) expect(await t.call(channel, payload, STICKY), channel).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    expect(t.s.count('reminders')).toBe(2);
  });

  it('without storage every reminder channel answers INTERNAL "Storage is unavailable"', async () => {
    const r = catalogueRouter(null, app);
    for (const [channel, payload] of [
      ['zones:list', {}],
      ['reminders:listView', { view: 'today' }],
      ['occurrence:complete', { occurrenceId: '0f8fad5b-d9cb-469f-a165-70867728950e' }],
    ] as const) {
      expect(await r.call(channel, payload), channel).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Storage is unavailable' } });
    }
  });
});

describe('Phase 05 widget and autostart channels (D-074, D-081, D-082)', () => {
  const WIDGET = 4;

  async function withWidget() {
    const s = await setupReminders();
    const note = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Widget source').note;
    const fake = fakeWidgetFactory([]);
    const widget = new WidgetManager({
      store: s.widgetState,
      factory: fake.factory,
      displays: fakeDisplays(),
      caps: () => WINDOWS_CAPS,
      emitState: () => undefined,
      logger: s.logger,
      timers: manualTimers(),
    });
    const autostartState = { enabled: false, calls: [] as boolean[] };
    let capability: CapabilityStatusType = { status: 'unsupported', reason: 'development-build' };
    const autostart = createAutostartControl({
      adapter: {
        isEnabled: () => autostartState.enabled,
        setEnabled: (enabled) => {
          autostartState.calls.push(enabled);
          autostartState.enabled = enabled;
        },
      },
      capability: () => capability,
      logger: s.logger,
    });
    const opened: string[] = [];
    const r = catalogueRouter(s.services, app, {
      desktop: { ...NO_DESKTOP, mainWindow: { ...NO_DESKTOP.mainWindow, openNote: (noteId) => opened.push(noteId) }, widget, autostart },
    });
    return { s, note, widget, fake, autostartState, setCapability: (c: CapabilityStatusType) => (capability = c), opened, call: r.call };
  }

  it('the widget reads its lists, acts on occurrences, opens sources and controls its own window', async () => {
    const t = await withWidget();
    const dto = (await t.call('reminder:create', reminderInput(t.note.id, { date: '2026-10-08', time: '12:00', allowPast: true }), MAIN)).data;
    expect(await t.call('widget:show', {}, MAIN)).toEqual({ ok: true, data: { open: true, collapsed: false, alwaysOnTop: false } });
    expect(await t.call('window:getState', {}, WIDGET)).toEqual({ ok: true, data: { role: 'widget', widget: { open: true, collapsed: false, alwaysOnTop: false } } });
    expect((await t.call('reminders:listView', { view: 'overdue' }, WIDGET)).data.items.map((i: { reminderId: string }) => i.reminderId)).toEqual([dto.id]);
    expect((await t.call('occurrence:snooze', { occurrenceId: dto.current.occurrenceId, preset: 10 }, WIDGET)).data.state).toBe('snoozed');
    expect((await t.call('occurrence:complete', { occurrenceId: dto.current.occurrenceId }, WIDGET)).data.state).toBe('completed');
    expect(await t.call('reminder:open', { reminderId: dto.id }, WIDGET)).toEqual({ ok: true, data: {} });
    expect(t.opened).toEqual([t.note.id]);
    expect((await t.call('widget:setCollapsed', { collapsed: true }, WIDGET)).data.collapsed).toBe(true);
    expect((await t.call('widget:setPinned', { pinned: true }, WIDGET)).data.alwaysOnTop).toBe(true);
    expect((await t.call('widget:hide', {}, WIDGET)).data.open).toBe(false);
    expect(t.fake.last().destroyed).toBe(true);
  });

  it('everything else answers FORBIDDEN to the widget and never runs', async () => {
    const t = await withWidget();
    const dto = (await t.call('reminder:create', reminderInput(t.note.id), MAIN)).data;
    const forbidden: Array<[string, unknown]> = [
      ['note:open', { noteId: t.note.id }],
      ['lease:acquire', { noteId: t.note.id, viewId: t.note.id }],
      ['session:set', { session: { version: 1, tabs: [{ id: 'home', kind: 'home' }], activeTabId: 'home' } }],
      ['tree:list', {}],
      ['trash:list', {}],
      ['reminder:create', reminderInput(t.note.id)],
      ['reminder:update', updateRequest(dto.id, 1)],
      ['reminder:delete', { reminderId: dto.id }],
      ['reminder:listForNote', { noteId: t.note.id }],
      ['zones:list', {}],
      ['widget:show', {}],
      ['autostart:set', { enabled: true }],
    ];
    for (const [channel, payload] of forbidden) expect(await t.call(channel, payload, WIDGET), channel).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    expect(t.fake.windows).toHaveLength(0);
    expect(t.s.count('reminders')).toBe(1);
  });

  it('autostart: read from the OS state; refused in development builds; changed where supported', async () => {
    const t = await withWidget();
    expect(await t.call('autostart:get', {}, MAIN)).toEqual({ ok: true, data: { enabled: false, capability: { status: 'unsupported', reason: 'development-build' } } });
    expect(await t.call('autostart:set', { enabled: true }, MAIN)).toEqual({ ok: false, error: { code: 'UNSUPPORTED', message: 'Not supported by this desktop' } });
    expect(t.autostartState.calls).toEqual([]);
    t.setCapability({ status: 'supported', reason: 'login-items' });
    expect((await t.call('autostart:set', { enabled: true }, MAIN)).data).toEqual({ enabled: true, capability: { status: 'supported', reason: 'login-items' } });
    expect(t.autostartState.calls).toEqual([true]);
    expect(await t.call('autostart:get', {}, STICKY)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});
