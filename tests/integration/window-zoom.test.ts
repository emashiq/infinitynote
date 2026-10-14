import { describe, expect, it } from 'vitest';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { settingsZoomStore, WindowZoom } from '../../src/main/windows/window-zoom';
import { setupServices } from './hierarchy-helpers';
import { catalogueRouter, NO_DESKTOP } from './ipc-helpers';

const NOT_USED = () => {
  throw new Error('not used');
};
const APP: AppHandlerDeps = { getInfo: NOT_USED, getCapabilities: NOT_USED, shell: { openPath: async () => '', openExternal: async () => {}, showItemInFolder: () => {} }, dataDir: '/data', quit: () => {}, flushed: () => true };
const MAIN = 1;
const STICKY = 3;
const WIDGET = 4;

async function setup() {
  const s = await setupServices();
  const sticky = s.note(null, null, 'Sticky', true);
  const zoom = new WindowZoom({ store: settingsZoomStore(s.settings), notify: () => undefined });
  const r = catalogueRouter(s.services, APP, { stickyNoteId: sticky.id, desktop: { ...NO_DESKTOP, zoom } });
  return { s, call: r.call };
}

describe('window:zoom (D-186)', () => {
  it('zooms the sender’s kind of window and keeps it in the main-only setting', async () => {
    const { s, call } = await setup();
    expect(await call('window:zoom', { action: 'in' }, MAIN)).toEqual({ ok: true, data: { percent: 110 } });
    expect(await call('window:zoom', { action: 'out' }, STICKY)).toEqual({ ok: true, data: { percent: 90 } });
    expect(await call('window:zoom', { action: 'in' }, WIDGET)).toEqual({ ok: true, data: { percent: 110 } });
    expect(await call('window:zoom', { action: 'in' }, MAIN)).toEqual({ ok: true, data: { percent: 125 } });
    expect(s.settings.getInternal('window.zoom')).toEqual({ main: 125, sticky: 90, widget: 110 });
    // Renderers cannot read or write it as a setting.
    expect((await call('settings:get', { keys: ['window.zoom'] }, MAIN)).error?.code).toBe('VALIDATION_FAILED');
    expect((await call('settings:set', { key: 'window.zoom', value: { main: 300, sticky: 300, widget: 300 } }, MAIN)).error?.code).toBe('VALIDATION_FAILED');
  });

  it('the main window learns its zoom in the ready handshake', async () => {
    const { call } = await setup();
    await call('window:zoom', { action: 'out' }, MAIN);
    expect(await call('window:getState', {}, MAIN)).toMatchObject({ ok: true, data: { role: 'main', zoom: 90 } });
  });

  it('accepts only in, out and reset', async () => {
    const { call } = await setup();
    for (const payload of [{ action: 'up' }, { action: 'in', percent: 300 }, {}]) {
      expect((await call('window:zoom', payload, MAIN)).error?.code, JSON.stringify(payload)).toBe('VALIDATION_FAILED');
    }
    expect(await call('window:zoom', { action: 'reset' }, MAIN)).toEqual({ ok: true, data: { percent: 100 } });
  });
});
