import { describe, expect, it } from 'vitest';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { GlobalShortcutService, type GlobalShortcutAdapter } from '../../src/main/services/global-shortcut';
import type { CapabilityStatusType } from '../../src/shared/contracts/app';
import { SHORTCUT_MESSAGES } from '../../src/shared/contracts/shortcuts';
import { setupServices, type Services } from './hierarchy-helpers';
import { NO_DESKTOP, catalogueRouter } from './ipc-helpers';
import { tmpFile } from './portability-helpers';

const SUPPORTED: CapabilityStatusType = { status: 'supported', reason: 'native-windows' };
const UNSUPPORTED: CapabilityStatusType = { status: 'unsupported', reason: 'wayland-or-wslg' };

/** A recording OS registry that refuses the accelerators in `taken`. */
function fakeRegistry(taken: string[] = []) {
  const callbacks = new Map<string, () => void>();
  const adapter: GlobalShortcutAdapter = {
    register: (accelerator, cb) => {
      if (taken.includes(accelerator)) return false;
      callbacks.set(accelerator, cb);
      return true;
    },
    unregister: (accelerator) => void callbacks.delete(accelerator),
  };
  return { adapter, callbacks, press: (accelerator: string) => callbacks.get(accelerator)?.() };
}

function service(s: Services, registry: ReturnType<typeof fakeRegistry>, capability = SUPPORTED) {
  const triggered: number[] = [];
  const shortcut = new GlobalShortcutService({
    adapter: registry.adapter,
    settings: s.settings,
    capability: () => capability,
    onTrigger: () => triggered.push(1),
    logger: s.logger,
  });
  return { shortcut, triggered };
}

describe('global quick-sticky shortcut (INF-KEY-05)', () => {
  it('is off by default and registers nothing at startup', async () => {
    const s = await setupServices();
    const registry = fakeRegistry();
    const { shortcut } = service(s, registry);
    shortcut.start();
    expect(registry.callbacks.size).toBe(0);
    expect(shortcut.state()).toEqual({ enabled: false, accelerator: 'CommandOrControl+Alt+N', registered: false, error: null, capability: SUPPORTED });
  });

  it('switched on it registers, a press creates a sticky, and the choice survives a restart; off unregisters', async () => {
    const s = await setupServices();
    const registry = fakeRegistry();
    const first = service(s, registry);
    expect(first.shortcut.set({ enabled: true, accelerator: 'CommandOrControl+Shift+Alt+N' })).toMatchObject({ enabled: true, registered: true, error: null });
    registry.press('CommandOrControl+Shift+Alt+N');
    expect(first.triggered).toHaveLength(1);
    first.shortcut.stop();
    expect(registry.callbacks.size).toBe(0);

    const second = service(s, registry);
    second.shortcut.start();
    expect([...registry.callbacks.keys()]).toEqual(['CommandOrControl+Shift+Alt+N']);
    expect(second.shortcut.set({ enabled: false, accelerator: 'CommandOrControl+Shift+Alt+N' })).toMatchObject({ enabled: false, registered: false });
    expect(registry.callbacks.size).toBe(0);
  });

  it('a shortcut held by another app is reported and not stored as on; at startup the failure is shown', async () => {
    const s = await setupServices();
    const registry = fakeRegistry(['CommandOrControl+Alt+N']);
    const { shortcut } = service(s, registry);
    expect(shortcut.set({ enabled: true, accelerator: 'CommandOrControl+Alt+N' })).toMatchObject({ enabled: false, registered: false, error: SHORTCUT_MESSAGES.taken });
    expect(s.settings.getInternal('shortcut.quickSticky')).toEqual({ enabled: false, accelerator: 'CommandOrControl+Alt+N' });
    expect(shortcut.set({ enabled: true, accelerator: 'CommandOrControl+Alt+Space' })).toMatchObject({ enabled: true, registered: true, error: null });

    // Another app took it while Infinity Notes was closed.
    const later = service(s, fakeRegistry(['CommandOrControl+Alt+Space']));
    later.shortcut.start();
    expect(later.shortcut.state()).toMatchObject({ enabled: true, registered: false, error: SHORTCUT_MESSAGES.taken });
  });

  it('is refused where the desktop has no global shortcuts', async () => {
    const s = await setupServices();
    const registry = fakeRegistry();
    const { shortcut } = service(s, registry, UNSUPPORTED);
    expect(() => shortcut.set({ enabled: true, accelerator: 'CommandOrControl+Alt+N' })).toThrow(SHORTCUT_MESSAGES.unsupported);
    expect(shortcut.set({ enabled: false, accelerator: 'CommandOrControl+Alt+N' }).capability).toEqual(UNSUPPORTED);
    s.t.db.prepare("UPDATE settings SET value = ? WHERE key = 'shortcut.quickSticky'").run(JSON.stringify({ v: 1, value: { enabled: true, accelerator: 'CommandOrControl+Alt+N' } }));
    shortcut.start();
    expect(registry.callbacks.size).toBe(0);
  });
});

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

describe('Phase 08 channels (D-099)', () => {
  it('main window: shortcut, backup status and export through the catalogue with response validation', async () => {
    const s = await setupServices();
    const note = s.note(null, null, 'Exported');
    const { shortcut } = service(s, fakeRegistry());
    const { call } = catalogueRouter(s.services, app, { desktop: { ...NO_DESKTOP, shortcut } });
    expect((await call('shortcut:setGlobal', { enabled: true, accelerator: 'CommandOrControl+Alt+N' })).data).toMatchObject({ enabled: true, registered: true });
    expect((await call('shortcut:getGlobal', {})).data).toMatchObject({ enabled: true, registered: true });
    expect((await call('backup:status', {})).data).toMatchObject({ auto: { enabled: false }, rollbackCopies: [] });
    s.pathQueue.push(tmpFile('n.txt'));
    expect((await call('export:markdown', { noteId: note.id, format: 'text' })).data).toMatchObject({ canceled: false, attachments: 0 });
    expect((await call('backup:create', {})).data).toEqual({ canceled: true });
  });

  it('validation and roles: bad payloads are refused; stickies and the widget have none of these channels', async () => {
    const s = await setupServices();
    const note = s.note(null, null, 'N');
    const { shortcut } = service(s, fakeRegistry());
    const { call } = catalogueRouter(s.services, app, { stickyNoteId: note.id, desktop: { ...NO_DESKTOP, shortcut } });
    for (const [channel, payload] of [
      ['backup:setAuto', { enabled: true, intervalDays: 2, keep: 5 }],
      ['backup:setAuto', { enabled: true, intervalDays: 7, keep: 5, directory: 'C:\\evil' }],
      ['backup:create', { file: 'C:\\evil.infinitybackup' }],
      ['export:markdown', { noteId: note.id, format: 'html' }],
      ['shortcut:setGlobal', { enabled: true, accelerator: 'Alt+F4' }],
    ] as const) {
      expect((await call(channel, payload)).error?.code, channel).toBe('VALIDATION_FAILED');
    }
    for (const channel of ['backup:create', 'backup:restore', 'backup:status', 'export:portable', 'import:portable', 'shortcut:getGlobal']) {
      for (const sender of [3, 4]) expect((await call(channel, {}, sender)).error?.code, `${channel} from ${sender}`).toBe('FORBIDDEN');
    }
    expect((await call('export:markdown', { noteId: note.id, format: 'text' }, 3)).error?.code).toBe('FORBIDDEN');
    const noStorage = catalogueRouter(null, app);
    expect((await noStorage.call('shortcut:getGlobal', {})).error).toEqual({ code: 'INTERNAL', message: 'Storage is unavailable' });
  });
});
