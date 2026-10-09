import { describe, expect, it, vi } from 'vitest';
import { registerAppHandlers } from '../../src/main/ipc/handlers/app-handlers';
import { registerSettingsHandlers } from '../../src/main/ipc/handlers/settings-handlers';
import { createIpcRouter } from '../../src/main/ipc/router';
import { createSenderPolicy, type IpcEventLike } from '../../src/main/ipc/sender-policy';
import { SettingsRepo } from '../../src/main/db/repositories/settings-repo';
import { AppError } from '../../src/main/services/app-error';
import { memoryLogger } from '../../src/main/services/logger';
import { SettingsService } from '../../src/main/services/settings-service';
import { fixedClock, openFresh } from './helpers';
import { INVOKE_CHANNELS, type InvokeChannel } from '../../src/shared/contracts/channel-names';
import { STICKY_ALLOWED_CHANNELS, WIDGET_ALLOWED_CHANNELS, isChannelAllowed } from '../../src/shared/contracts/channel-roles';
import { fakeIpcMain, rendererEvent as goodEvent, rolesRegistry } from './ipc-helpers';

function makeRouter(opts: { validateResponses?: boolean; devOrigin?: string | null; registered?: number[] } = {}) {
  const ipc = fakeIpcMain();
  const logger = memoryLogger();
  const registered = new Set(opts.registered ?? [1]);
  const router = createIpcRouter({
    ipcMain: ipc.ipcMain,
    senderPolicy: createSenderPolicy({ registry: { info: (id) => (registered.has(id) ? { role: 'main' as const } : undefined) }, devOrigin: opts.devOrigin }),
    logger,
    validateResponses: opts.validateResponses ?? true,
  });
  return { ...ipc, router, logger };
}

describe('IPC router (INF-FND-04)', () => {
  it('valid call returns ok and reaches the handler with the webContents id and sender role', async () => {
    const r = makeRouter();
    const handler = vi.fn(() => ({}));
    r.router.register('app:quit', handler);
    expect(await r.call('app:quit', {})).toEqual({ ok: true, data: {} });
    expect(handler).toHaveBeenCalledWith({}, { webContentsId: 1, sender: { role: 'main' } });
  });

  it('invalid payload gives VALIDATION_FAILED naming the path and does not call the handler', async () => {
    const r = makeRouter();
    const handler = vi.fn(() => ({ values: {} }));
    r.router.register('settings:get', handler);
    const res = await r.call('settings:get', { keys: ["appearance.theme'; DROP TABLE settings;--"] });
    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Invalid request: keys.0' } });
    expect(JSON.stringify(res)).not.toContain('DROP TABLE');
    expect(handler).not.toHaveBeenCalled();
    expect(await r.call('settings:get', { keys: ['appearance.theme'], extra: 1 })).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('the four forbidden sender kinds give FORBIDDEN and never call the handler', async () => {
    const r = makeRouter();
    const handler = vi.fn(() => ({}));
    r.router.register('app:quit', handler);
    const bad: IpcEventLike[] = [
      goodEvent({ senderFrame: { url: 'https://evil.example/', parent: null } }),
      goodEvent({ senderFrame: { url: 'file:///C:/x.html', parent: null } }),
      goodEvent({ senderFrame: { url: 'infinity-app://renderer/index.html', parent: {} } }),
      goodEvent({ sender: { id: 99 } }),
      goodEvent({ senderFrame: null }),
      goodEvent({ senderFrame: { url: 'infinity-app://other/index.html', parent: null } }),
      goodEvent({ senderFrame: { url: 'garbage', parent: null } }),
    ];
    for (const ev of bad) {
      expect(await r.call('app:quit', {}, ev)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    expect(handler).not.toHaveBeenCalled();
    expect(r.logger.lines.some((l) => l.includes('ipc: forbidden sender channel=app:quit'))).toBe(true);
  });

  it('the dev origin is accepted only when configured', async () => {
    const devEvent = goodEvent({ senderFrame: { url: 'http://localhost:5173/', parent: null } });
    const without = makeRouter();
    without.router.register('app:quit', () => ({}));
    expect(await without.call('app:quit', {}, devEvent)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    const withDev = makeRouter({ devOrigin: 'http://localhost:5173' });
    withDev.router.register('app:quit', () => ({}));
    expect(await withDev.call('app:quit', {}, devEvent)).toMatchObject({ ok: true });
    const other = goodEvent({ senderFrame: { url: 'http://localhost:6000/', parent: null } });
    expect(await withDev.call('app:quit', {}, other)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('a 5 MiB + 1 payload gives LIMIT_EXCEEDED', async () => {
    const r = makeRouter();
    const handler = vi.fn(() => {
      throw new Error('not reached');
    });
    r.router.register('settings:set', handler);
    const big = 'x'.repeat(5 * 1024 * 1024 + 1);
    expect(await r.call('settings:set', { key: 'appearance.theme', value: big })).toMatchObject({ error: { code: 'LIMIT_EXCEEDED' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('AppError passes through with details; other errors give INTERNAL with no leak', async () => {
    const r = makeRouter();
    r.router.register('app:quit', () => {
      throw new AppError('CONFLICT', 'changed', { currentRevision: 3 });
    });
    expect(await r.call('app:quit', {})).toEqual({ ok: false, error: { code: 'CONFLICT', message: 'changed', details: { currentRevision: 3 } } });

    const r2 = makeRouter();
    r2.router.register('app:quit', () => {
      throw new Error('/secret/path/leak.sqlite');
    });
    const res = await r2.call('app:quit', {});
    expect(res).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong' } });
    expect(JSON.stringify(res)).not.toContain('/secret');
    expect(r2.logger.lines.join('\n')).toContain('/secret/path/leak.sqlite');
  });

  it('a response-schema mismatch gives INTERNAL when validateResponses is on', async () => {
    const strict = makeRouter({ validateResponses: true });
    strict.router.register('app:showDataFolder', () => ({ opened: false }) as never);
    expect(await strict.call('app:showDataFolder', {})).toMatchObject({ error: { code: 'INTERNAL' } });
    const lax = makeRouter({ validateResponses: false });
    lax.router.register('app:showDataFolder', () => ({ opened: false }) as never);
    expect(await lax.call('app:showDataFolder', {})).toMatchObject({ ok: true });
  });

  it('refuses channels outside the catalogue and duplicates; dispose removes handlers', () => {
    const r = makeRouter();
    expect(() => r.router.register('note:trashed' as never, () => ({}) as never)).toThrow(/catalogue/);
    r.router.register('app:quit', () => ({}));
    expect(() => r.router.register('app:quit', () => ({}))).toThrow(/already/);
    expect(r.handlers.size).toBe(1);
    r.router.dispose();
    expect(r.handlers.size).toBe(0);
  });
});

describe('handlers over the router', () => {
  it('settings handlers validate and persist', async () => {
    const t = await openFresh();
    const r = makeRouter();
    const events: unknown[] = [];
    const service = new SettingsService({ repo: new SettingsRepo(t.db), clock: fixedClock(), logger: r.logger, emit: (p) => events.push(p) });
    registerSettingsHandlers(r.router, () => service);
    expect(await r.call('settings:set', { key: 'appearance.theme', value: 'dark' })).toMatchObject({ ok: true, data: { key: 'appearance.theme', value: 'dark' } });
    expect(await r.call('settings:get', { keys: ['appearance.theme'] })).toEqual({ ok: true, data: { values: { 'appearance.theme': 'dark' } } });
    expect(await r.call('settings:set', { key: 'appearance.theme', value: 'neon' })).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(await r.call('settings:set', { key: 'x.y', value: 1 })).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(events).toHaveLength(1);
    expect(t.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM settings').get()?.n).toBe(1);
  });

  it('app handlers: showDataFolder maps shell errors to UNSUPPORTED, quit replies then quits', async () => {
    const r = makeRouter();
    const calls: string[] = [];
    let shellError = '';
    const quit = vi.fn();
    registerAppHandlers(r.router, {
      getInfo: () => {
        throw new Error('not used');
      },
      getCapabilities: () => {
        throw new Error('not used');
      },
      shell: {
        openPath: async (p) => {
          calls.push(p);
          return shellError;
        },
        openExternal: async () => {},
        showItemInFolder: () => {},
      },
      dataDir: '/data/dir',
      quit,
      flushed: () => false,
    });
    expect(await r.call('app:showDataFolder', {})).toEqual({ ok: true, data: { opened: true } });
    expect(calls).toEqual(['/data/dir']);
    shellError = 'no file manager';
    const res = await r.call('app:showDataFolder', {});
    expect(res).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } });
    expect(JSON.stringify(res)).not.toContain('no file manager');
    expect(await r.call('app:quit', {})).toEqual({ ok: true, data: {} });
    expect(quit).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
    expect(quit).toHaveBeenCalledTimes(1);
  });
});

describe('role allowlist and note ownership (D-064)', () => {
  const OWN = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const U = '2c1d7a3e-8f6b-4c0d-9a5e-1b2c3d4e5f60';

  function rolesRouter() {
    const ipc = fakeIpcMain();
    const logger = memoryLogger();
    const router = createIpcRouter({ ipcMain: ipc.ipcMain, senderPolicy: createSenderPolicy({ registry: rolesRegistry(OWN) }), logger, validateResponses: false });
    const calls: string[] = [];
    for (const channel of INVOKE_CHANNELS) router.register(channel, () => (calls.push(channel), {}) as never);
    const asSticky = (channel: string, payload: unknown) => ipc.call(channel, payload, goodEvent({ sender: { id: 3 } }));
    const asMain = (channel: string, payload: unknown) => ipc.call(channel, payload, goodEvent({ sender: { id: 1 } }));
    return { calls, logger, asSticky, asMain };
  }

  it('the allowlist has exactly the planned sticky channels', () => {
    expect([...STICKY_ALLOWED_CHANNELS].sort()).toEqual(
      [
        'app:getInfo', 'app:quit', 'app:flushed', 'capabilities:get', 'settings:get', 'note:open', 'note:save', 'note:rename', 'note:trash',
        'note:convertFormat', 'versions:list', 'versions:restore', 'drafts:list',
        'drafts:resolve', 'attachment:importBytes', 'attachment:pickFiles', 'shell:openExternal', 'window:getState', 'sticky:dock',
        'sticky:hide', 'sticky:setColor', 'sticky:setPinned', 'sticky:setCollapsed', 'sticky:remove', 'sticky:restore',
        'reminder:listForNote', 'reminder:open',
        // Phase 06 (D-089): suggestions and hand-entered reminders for the sticky's own note.
        'zones:list', 'reminder:create', 'reminder:createFromSuggestion', 'suggestion:dismiss', 'suggestion:listDismissed',
        // Phase 07 (D-098): the sticky's own note's attached files.
        'attachment:open', 'attachment:showInFolder',
        // D-103: live sync of the sticky's own note.
        'collab:join', 'collab:push', 'collab:pull', 'collab:flush', 'collab:leave',
        // v0.2.0: the sticky's own default text color.
        'sticky:setTextColor',
        // v0.2.0 (D-108): copying picked files or linking files, and its note's linked files.
        'attachment:addPicked', 'fileLink:create', 'fileLink:status', 'fileLink:open', 'fileLink:showInFolder', 'fileLink:copyIn',
      ].sort(),
    );
    for (const channel of INVOKE_CHANNELS) expect(isChannelAllowed('main', channel)).toBe(true);
  });

  it('the widget has its own allowlist: its lists and actions, never notes, tabs, the tree or reminder edits (D-074)', () => {
    expect([...WIDGET_ALLOWED_CHANNELS].sort()).toEqual(
      [
        'app:getInfo', 'app:quit', 'app:flushed', 'capabilities:get', 'settings:get', 'window:getState', 'reminders:listView',
        'occurrence:complete', 'occurrence:snooze', 'reminder:open', 'widget:hide', 'widget:setPinned', 'widget:setCollapsed',
      ].sort(),
    );
    for (const channel of INVOKE_CHANNELS) expect(isChannelAllowed('widget', channel), channel).toBe(WIDGET_ALLOWED_CHANNELS.has(channel));
    for (const channel of ['note:open', 'collab:join', 'session:set', 'tree:list', 'trash:list', 'reminder:create', 'reminder:update', 'reminder:delete', 'widget:show'] as const) {
      expect(isChannelAllowed('widget', channel), channel).toBe(false);
    }
  });

  it('every main-only channel group answers FORBIDDEN to a sticky window and never reaches its handler', async () => {
    const r = rolesRouter();
    const mainOnly = INVOKE_CHANNELS.filter((c) => !STICKY_ALLOWED_CHANNELS.has(c));
    for (const group of ['session:', 'settings:set', 'tree:', 'trash:', 'project:', 'folder:', 'item:', 'note:create', 'note:move', 'home:', 'palette:', 'app:showDataFolder', 'sticky:float', 'lock:']) {
      expect(mainOnly.some((c) => c.startsWith(group)), group).toBe(true);
    }
    for (const channel of mainOnly) {
      expect(await r.asSticky(channel, { noteId: OWN }), channel).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    }
    expect(r.calls).toEqual([]);
    expect(r.logger.lines.some((l) => l.includes('ipc: channel not allowed for role=sticky channel=session:set'))).toBe(true);
    // The same requests from the main window pass the role check.
    expect(await r.asMain('tree:list', {})).toMatchObject({ ok: true });
    expect(r.calls).toEqual(['tree:list']);
  });

  it('a sticky may name only its own note; requests without a note id are not affected', async () => {
    const r = rolesRouter();
    const op = (noteId: string) => ({ noteId, viewId: U, baseRevision: 1, requestId: U });
    const cases: Array<[InvokeChannel, (noteId: string) => unknown]> = [
      ['note:open', (noteId) => ({ noteId })],
      ['note:rename', (noteId) => ({ noteId, title: 't' })],
      ['note:trash', (noteId) => ({ noteId })],
      ['collab:join', (noteId) => ({ noteId, viewId: U })],
      ['collab:push', (noteId) => ({ noteId, viewId: U, epoch: U, version: 0, steps: [{ stepType: 'replace' }] })],
      ['collab:flush', (noteId) => ({ noteId, viewId: U })],
      ['collab:leave', (noteId) => ({ noteId, viewId: U })],
      ['versions:list', (noteId) => ({ noteId })],
      ['drafts:list', (noteId) => ({ noteId })],
      ['drafts:resolve', (noteId) => ({ action: 'dismiss', noteId, draftId: U })],
      ['drafts:resolve', (noteId) => ({ action: 'restore', ...op(noteId), draftId: U })],
    ];
    for (const [channel, payload] of cases) {
      expect(await r.asSticky(channel, payload(OTHER)), `${channel} other`).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });
      expect(await r.asSticky(channel, payload(OWN)), `${channel} own`).toMatchObject({ ok: true });
      expect(await r.asMain(channel, payload(OTHER)), `${channel} main`).toMatchObject({ ok: true });
    }
    expect(await r.asSticky('app:getInfo', {})).toMatchObject({ ok: true });
    expect(r.logger.lines.some((l) => l.includes('ipc: note not owned by the sticky sender channel=note:open'))).toBe(true);
  });
});
