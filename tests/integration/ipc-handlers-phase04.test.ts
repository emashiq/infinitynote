import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CapabilitiesType } from '../../src/shared/contracts/app';
import { CHANNEL_SCHEMAS } from '../../src/shared/contracts/channels';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { closeDialogOptions } from '../../src/main/services/close-dialog';
import { MainWindowController } from '../../src/main/windows/main-window-controller';
import { StickyManager } from '../../src/main/windows/sticky-manager';
import { setupServices } from './hierarchy-helpers';
import { catalogueRouter, NO_DESKTOP } from './ipc-helpers';
import { fakeDisplays, fakeStickyFactory, manualTimers, WINDOWS_CAPS, WSLG_CAPS } from './sticky-fakes';

const MISSING = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const MAIN = 1;
const STICKY = 3;

const app: AppHandlerDeps = {
  getInfo: () => {
    throw new Error('not used');
  },
  getCapabilities: () => {
    throw new Error('not used');
  },
  shell: { openPath: async () => '', openExternal: async () => {}, showItemInFolder: () => {} },
  dataDir: '/data',
  quit: () => {},
  flushed: () => false,
};

async function setup(opts: { caps?: CapabilitiesType } = {}) {
  let stickies: StickyManager | null = null;
  const s = await setupServices({ onTreeChanged: () => stickies?.onTreeChanged() });
  const own = s.note(null, null, 'Own');
  const other = s.note(null, null, 'Other', true);
  const fake = fakeStickyFactory([]);
  const opened: Array<{ webContentsId: number; noteId: string; blockId: string | null }> = [];
  const mainWindow = new MainWindowController({
    factory: {
      create: () => ({ webContentsId: MAIN, load() {}, show() {}, focus() {}, restore() {}, isMinimized: () => false, isFocused: () => true, flashFrame() {}, close() {}, isDestroyed: () => false }),
    },
    sendOpenNote: (webContentsId, e) => opened.push({ webContentsId, ...e }),
    sendOpenReminders: () => {},
    closeBehavior: () => 'ask',
    rememberCloseBehavior: () => {},
    closeDialogOptions: () => closeDialogOptions({ platform: 'win32', trayStatus: 'supported' }),
    askClose: async () => ({ choice: 'cancel', remember: false }),
    flush: async () => true,
    quit: () => {},
    isQuitting: () => false,
    logger: s.logger,
  });
  mainWindow.ensure();
  stickies = new StickyManager({
    service: s.stickies,
    factory: fake.factory,
    displays: fakeDisplays(),
    caps: () => opts.caps ?? WINDOWS_CAPS,
    flush: async () => true,
    resetViews: (id) => s.collab.webContentsReset(id),
    sendState: () => {},
    trash: s.trash,
    mainWindow,
    restoreOnStartupEnabled: () => false,
    theme: () => 'light',
    logger: s.logger,
    timers: manualTimers(),
  });
  const r = catalogueRouter(s.services, app, { stickyNoteId: own.id, desktop: { ...NO_DESKTOP, mainWindow, stickies } });
  /** Every successful answer must match the channel's response schema (validateResponses is on as well). */
  const call = async (channel: keyof typeof CHANNEL_SCHEMAS, payload: unknown, from = MAIN) => {
    const res = await r.call(channel, payload, from);
    if (res.ok) expect(CHANNEL_SCHEMAS[channel].response.safeParse(res.data).success, channel).toBe(true);
    return res;
  };
  return { s, own, other, call, mainWindow, stickies, opened, windows: fake.windows };
}

const FORBIDDEN = { ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } };

describe('Phase 04 IPC handlers (D-063, D-064)', () => {
  it('sticky:float works from the main window only and validates the note', async () => {
    const t = await setup();
    expect(await t.call('sticky:float', { noteId: t.own.id })).toEqual({ ok: true, data: { noteId: t.own.id, created: true } });
    expect(await t.call('sticky:float', { noteId: t.own.id })).toEqual({ ok: true, data: { noteId: t.own.id, created: false } });
    expect(await t.call('sticky:float', { noteId: t.own.id }, STICKY)).toEqual(FORBIDDEN);
    expect(await t.call('sticky:float', { noteId: MISSING })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', message: 'This note no longer exists' } });
    expect(await t.call('sticky:float', { noteId: 'abc' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const { trashBatchId } = t.s.trash.trashNote(t.other.id);
    expect(await t.call('sticky:float', { noteId: t.other.id })).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'This note is in Trash', details: { trashed: true, trashBatchId } },
    });
    expect(t.windows).toHaveLength(1);
  });

  it('window:getState answers the main handshake with queued opens and a sticky with its own state', async () => {
    const t = await setup();
    t.mainWindow.openNote(t.other.id);
    expect(await t.call('window:getState', {})).toEqual({ ok: true, data: { role: 'main', openNotes: [{ noteId: t.other.id, blockId: null }], openReminders: null, widget: { open: false, collapsed: false, alwaysOnTop: false } } });
    expect(await t.call('window:getState', {})).toEqual({ ok: true, data: { role: 'main', openNotes: [], openReminders: null, widget: { open: false, collapsed: false, alwaysOnTop: false } } });
    await t.call('sticky:float', { noteId: t.own.id });
    expect(await t.call('window:getState', {}, STICKY)).toMatchObject({
      ok: true,
      data: { role: 'sticky', sticky: { noteId: t.own.id, title: 'Own', color: 'yellow', path: ['Common'], trashed: null, collapsed: false, alwaysOnTop: false, activation: 1 } },
    });
    expect(await t.call('window:getState', { noteId: t.other.id }, STICKY)).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('a sticky window may run every sticky action on its own note and none on another note', async () => {
    const t = await setup();
    await t.call('sticky:float', { noteId: t.own.id });
    for (const [channel, payload] of [
      ['sticky:setColor', { noteId: t.other.id, color: 'blue' }],
      ['sticky:setPinned', { noteId: t.other.id, pinned: true }],
      ['sticky:setCollapsed', { noteId: t.other.id, collapsed: true }],
      ['sticky:hide', { noteId: t.other.id }],
      ['sticky:dock', { noteId: t.other.id }],
      ['sticky:remove', { noteId: t.other.id }],
      ['sticky:restore', { noteId: t.other.id }],
    ] as const) {
      expect(await t.call(channel, payload, STICKY), channel).toEqual(FORBIDDEN);
    }
    expect(t.s.row<{ color: string }>('SELECT color FROM notes WHERE id = ?', t.other.id)?.color).toBe('yellow');

    expect(await t.call('sticky:setColor', { noteId: t.own.id, color: 'blue' }, STICKY)).toMatchObject({ ok: true, data: { color: 'blue' } });
    expect(await t.call('sticky:setPinned', { noteId: t.own.id, pinned: true }, STICKY)).toMatchObject({ ok: true, data: { alwaysOnTop: true } });
    expect(await t.call('sticky:setCollapsed', { noteId: t.own.id, collapsed: true }, STICKY)).toMatchObject({ ok: true, data: { collapsed: true } });
    expect(await t.call('sticky:dock', { noteId: t.own.id }, STICKY)).toEqual({ ok: true, data: {} });
    expect(t.stickies.isFloating(t.own.id)).toBe(false);
    expect(t.mainWindow.rendererReady(MAIN)).toEqual({ openNotes: [{ noteId: t.own.id, blockId: null }], openReminders: null });

    await t.call('sticky:float', { noteId: t.own.id });
    expect(await t.call('sticky:hide', { noteId: t.own.id }, STICKY)).toEqual({ ok: true, data: {} });
    expect(t.s.stickies.state(t.own.id).open).toBe(false);
    await t.call('sticky:float', { noteId: t.own.id });
    expect(await t.call('sticky:remove', { noteId: t.own.id }, STICKY)).toEqual({ ok: true, data: {} });
    expect(t.s.row<{ sticky_enabled: number }>('SELECT sticky_enabled FROM notes WHERE id = ?', t.own.id)?.sticky_enabled).toBe(0);
    expect(t.opened).toEqual([{ webContentsId: MAIN, noteId: t.own.id, blockId: null }]);
  });

  it('sticky:restore restores the own trashed note and refuses a live one; setColor needs a sticky', async () => {
    const t = await setup();
    await t.call('sticky:float', { noteId: t.own.id });
    expect(await t.call('sticky:restore', { noteId: t.own.id }, STICKY)).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'This note is not in Trash' } });
    expect(await t.call('note:trash', { noteId: t.own.id }, STICKY)).toMatchObject({ ok: true });
    expect(await t.call('window:getState', {}, STICKY)).toMatchObject({ data: { sticky: { trashed: { batchId: expect.any(String) } } } });
    expect(await t.call('sticky:restore', { noteId: t.own.id }, STICKY)).toMatchObject({ ok: true, data: { kind: 'note', id: t.own.id, path: ['Common'], relocated: false } });
    expect(t.s.row<{ deleted_at: number | null }>('SELECT deleted_at FROM notes WHERE id = ?', t.own.id)?.deleted_at).toBeNull();

    const plain = t.s.note(null, null, 'plain');
    expect(await t.call('sticky:setColor', { noteId: plain.id, color: 'pink' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'This note is not a sticky' } });
    expect(await t.call('sticky:setColor', { noteId: t.other.id, color: 'pink' })).toEqual({ ok: true, data: null });
  });

  it('pin answers UNSUPPORTED where always-on-top is unsupported and stores nothing', async () => {
    const t = await setup({ caps: WSLG_CAPS });
    await t.call('sticky:float', { noteId: t.own.id });
    expect(await t.call('sticky:setPinned', { noteId: t.own.id, pinned: true }, STICKY)).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED', message: 'Not supported by this desktop' },
    });
    expect(t.s.stickies.state(t.own.id).alwaysOnTop).toBe(false);
  });

  it('a sticky and the main window edit the same note at once; each gets the steps of the other (D-103)', async () => {
    const t = await setup();
    const stickyView = randomUUID();
    const tabView = randomUUID();
    const sticky = await t.call('collab:join', { noteId: t.own.id, viewId: stickyView }, STICKY);
    const tab = await t.call('collab:join', { noteId: t.own.id, viewId: tabView }, MAIN);
    expect(tab).toMatchObject({ ok: true, data: { epoch: sticky.data.epoch } });
    const step = { stepType: 'replace', from: 1, to: 1, slice: { content: [{ type: 'text', text: 'both' }] } };
    expect(await t.call('collab:push', { noteId: t.own.id, viewId: stickyView, epoch: sticky.data.epoch, version: 0, steps: [step] }, STICKY)).toMatchObject({ ok: true, data: { status: 'accepted' } });
    expect(await t.call('collab:push', { noteId: t.own.id, viewId: tabView, epoch: tab.data.epoch, version: 0, steps: [step] }, MAIN)).toMatchObject({ ok: true, data: { status: 'behind', version: 1 } });
    expect(t.s.collabEvents.filter((e) => e.channel === 'collab:steps').map((e) => e.webContentsId).sort()).toEqual([MAIN, STICKY].sort());
    // A sticky syncs only its own note.
    expect(await t.call('collab:join', { noteId: t.other.id, viewId: stickyView }, STICKY)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('without storage the sticky channels answer INTERNAL and the main handshake still works', async () => {
    const r = catalogueRouter(null, app);
    expect(await r.call('sticky:float', { noteId: MISSING })).toMatchObject({ ok: false, error: { code: 'INTERNAL', message: 'Storage is unavailable' } });
    expect(await r.call('window:getState', {})).toEqual({ ok: true, data: { role: 'main', openNotes: [], openReminders: null, widget: { open: false, collapsed: false, alwaysOnTop: false } } });
  });
});
