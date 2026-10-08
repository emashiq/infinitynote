import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_FAILED_NOTICE, TAB_LIMIT_NOTICE } from '../../../../src/renderer/state/tabs-store';
import { DEFAULT_SESSION } from '../../../../src/shared/contracts/session';
import { makeNote, setupServices } from '../support/services';

const noticeTexts = (s: Awaited<ReturnType<typeof setupServices>>['services']) => s.notices.store.getState().notices.map((n) => n.text);
const ids = (s: Awaited<ReturnType<typeof setupServices>>['services']) => s.tabs.store.getState().session.tabs.map((t) => t.id);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('TabsStore', () => {
  it('starts with Home only and writes nothing until the user changes something', async () => {
    const { services, fake } = await setupServices();
    expect(services.tabs.store.getState()).toMatchObject({ ready: true, session: DEFAULT_SESSION });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fake.callsTo('session:set')).toHaveLength(0);
  });

  it('persists on every structural change and never duplicates tabs', async () => {
    const { services, fake } = await setupServices();
    const a = await makeNote(fake, undefined, 'A');
    const b = await makeNote(fake, undefined, 'B');
    expect(await services.tabs.openNote(a.id)).toBe(true);
    await services.tabs.idle();
    expect(fake.callsTo('session:set')).toHaveLength(1);
    await services.tabs.openNote(b.id);
    await services.tabs.openPage('stickies');
    await services.tabs.openPage('stickies');
    await services.tabs.openNote(a.id);
    await services.tabs.idle();
    expect(ids(services)).toEqual(['home', `note:${a.id}`, `note:${b.id}`, 'page:stickies']);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${a.id}`);
    const last = fake.callsTo('session:set').at(-1)?.req as { session: { tabs: unknown[]; activeTabId: string } };
    expect(last.session.tabs).toHaveLength(4);
    expect(last.session.activeTabId).toBe(`note:${a.id}`);
    expect(fake.data.getSession().activeTabId).toBe(`note:${a.id}`);
  });

  it('only the active note tab has a controller; switching releases the lease after a flush', async () => {
    const { services, fake } = await setupServices();
    const a = await makeNote(fake, undefined, 'A');
    const b = await makeNote(fake, undefined, 'B');
    await services.tabs.openNote(a.id);
    await vi.advanceTimersByTimeAsync(0);
    const ca = services.tabs.activeController()!;
    expect(ca.noteId).toBe(a.id);
    ca.setText('typed in A');
    await services.tabs.openNote(b.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(services.tabs.activeController()?.noteId).toBe(b.id);
    expect(JSON.stringify(fake.data.notes.find((n) => n.id === a.id)!.content)).toContain('typed in A');
    expect(fake.data.leases.has(a.id)).toBe(false);
    expect(fake.data.leases.has(b.id)).toBe(true);
    await services.tabs.activate('home');
    expect(services.tabs.activeController()).toBeNull();
    expect(fake.data.leases.size).toBe(0);
  });

  it('a failed flush keeps the tab, shows the error notice and does not change the session', async () => {
    const { services, fake } = await setupServices();
    const a = await makeNote(fake, undefined, 'A');
    await services.tabs.openNote(a.id);
    await vi.advanceTimersByTimeAsync(0);
    services.tabs.activeController()!.setText('unsaved');
    fake.failNext('note:save', { code: 'INTERNAL' }, 4);
    const attempt = services.tabs.activate('home');
    await vi.advanceTimersByTimeAsync(3500);
    expect(await attempt).toBe(false);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${a.id}`);
    expect(noticeTexts(services)).toEqual([SAVE_FAILED_NOTICE]);
    expect(services.notices.store.getState().notices[0]?.tone).toBe('error');
    // closing is refused the same way
    fake.failNext('note:save', { code: 'INTERNAL' }, 4);
    const close = services.tabs.close(`note:${a.id}`);
    await vi.advanceTimersByTimeAsync(3500);
    expect(await close).toBe(false);
    expect(ids(services)).toContain(`note:${a.id}`);
  });

  it('proceeds when the flush fails with CONFLICT because main kept a draft', async () => {
    const { services, fake } = await setupServices();
    const a = await makeNote(fake, undefined, 'A');
    await services.tabs.openNote(a.id);
    await vi.advanceTimersByTimeAsync(0);
    services.tabs.activeController()!.setText('x');
    fake.failNext('note:save', { code: 'CONFLICT' });
    expect(await services.tabs.activate('home')).toBe(true);
    expect(services.tabs.store.getState().session.activeTabId).toBe('home');
    expect(noticeTexts(services)).toEqual([]);
  });

  it('closes tabs with right-neighbour, then left-neighbour activation, and never closes Home', async () => {
    const { services, fake } = await setupServices();
    const [a, b, c] = [await makeNote(fake, undefined, 'A'), await makeNote(fake, undefined, 'B'), await makeNote(fake, undefined, 'C')];
    for (const n of [a, b, c]) await services.tabs.openNote(n.id);
    await services.tabs.activate(`note:${b.id}`);
    expect(await services.tabs.closeActive()).toBe(true);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${c.id}`);
    expect(await services.tabs.close(`note:${c.id}`)).toBe(true);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${a.id}`);
    await services.tabs.activate('home');
    expect(await services.tabs.closeActive()).toBe(false);
    expect(await services.tabs.close('home')).toBe(false);
    expect(ids(services)).toEqual(['home', `note:${a.id}`]);
    expect(await services.tabs.next()).toBe(true);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${a.id}`);
    await services.tabs.next();
    expect(services.tabs.store.getState().session.activeTabId).toBe('home');
    await services.tabs.prev();
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${a.id}`);
  });

  it('closeNoteTabs closes trashed notes with singular and plural notices (via tree:changed)', async () => {
    const { services, fake } = await setupServices();
    const [a, b, c] = [await makeNote(fake, undefined, 'A'), await makeNote(fake, undefined, 'B'), await makeNote(fake, undefined, 'C')];
    for (const n of [a, b, c]) await services.tabs.openNote(n.id);
    await vi.advanceTimersByTimeAsync(0);
    const r = await fake.bridge.note.trash({ noteId: c.id });
    expect(r.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(ids(services)).toEqual(['home', `note:${a.id}`, `note:${b.id}`]);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${b.id}`);
    expect(noticeTexts(services)).toEqual(['1 tab was closed because its note is in Trash']);
    await fake.bridge.note.trash({ noteId: a.id });
    await fake.bridge.note.trash({ noteId: b.id });
    await vi.advanceTimersByTimeAsync(10);
    expect(ids(services)).toEqual(['home']);
    expect(services.tabs.store.getState().session.activeTabId).toBe('home');
    expect(noticeTexts(services).at(-1)).toMatch(/^(2 tabs were closed because their notes are in Trash|1 tab was closed because its note is in Trash)$/);
    expect(fake.data.leases.size).toBe(0);
  });

  it('folder trash closes both open notes with one plural notice', async () => {
    const { services, fake } = await setupServices();
    const folder = await fake.bridge.folder.create({ location: { projectId: null, parentId: null }, name: 'F' });
    if (!folder.ok) throw new Error('folder');
    const loc = { projectId: null, folderId: folder.data.folder.id };
    const a = await makeNote(fake, loc, 'A');
    const b = await makeNote(fake, loc, 'B');
    await services.tabs.openNote(a.id);
    await services.tabs.openNote(b.id);
    await services.tree.reload();
    const r = await services.tree.trashFolder(folder.data.folder.id);
    expect(r.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(ids(services)).toEqual(['home']);
    expect(noticeTexts(services)).toEqual(['2 tabs were closed because their notes are in Trash']);
  });

  it('init with dropped counts shows the right notice and persists the sanitized session once', async () => {
    const { createFakeBridge } = await import('../support/fake-bridge');
    const fake = createFakeBridge();
    fake.data.setDropped({ trashed: 1, missing: 1, duplicates: 2 });
    const { services } = await setupServices({ fake });
    await services.tabs.idle();
    expect(noticeTexts(services)).toEqual(['2 tabs were closed because their notes are in Trash or no longer exist']);
    expect(fake.callsTo('session:set')).toHaveLength(1);

    const fake2 = createFakeBridge();
    fake2.data.setDropped({ trashed: 1, missing: 0, duplicates: 0 });
    const second = await setupServices({ fake: fake2 });
    expect(noticeTexts(second.services)).toEqual(['1 tab was closed because its note is in Trash']);

    const fake3 = createFakeBridge();
    fake3.data.setDropped({ trashed: 0, missing: 0, duplicates: 3 });
    const third = await setupServices({ fake: fake3 });
    await third.services.tabs.idle();
    expect(noticeTexts(third.services)).toEqual([]);
    expect(fake3.callsTo('session:set')).toHaveLength(1);
  });

  it('refuses a 201st tab with a notice', async () => {
    const { services, fake } = await setupServices();
    const base = await makeNote(fake, undefined, 'seed');
    const tabs = Array.from({ length: 199 }, (_, i) => {
      const noteId = `99999999-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
      return { id: `note:${noteId}`, kind: 'note' as const, noteId };
    });
    services.tabs.store.setState({ session: { version: 1, tabs: [{ id: 'home', kind: 'home' }, ...tabs], activeTabId: 'home' } });
    expect(await services.tabs.openNote(base.id)).toBe(false);
    expect(noticeTexts(services)).toEqual([TAB_LIMIT_NOTICE]);
    expect(services.tabs.store.getState().session.tabs).toHaveLength(200);
  });

  it('scroll positions are debounced 500 ms and persisted in the session', async () => {
    const { services, fake } = await setupServices();
    const a = await makeNote(fake, undefined, 'A');
    await services.tabs.openNote(a.id);
    await services.tabs.idle();
    const before = fake.callsTo('session:set').length;
    services.tabs.setScrollTop(`note:${a.id}`, 100);
    services.tabs.setScrollTop(`note:${a.id}`, 240);
    await vi.advanceTimersByTimeAsync(499);
    expect(fake.callsTo('session:set')).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    await services.tabs.idle();
    expect(fake.callsTo('session:set')).toHaveLength(before + 1);
    const tab = services.tabs.store.getState().session.tabs.find((t) => t.id === `note:${a.id}`);
    expect(tab).toMatchObject({ scrollTop: 240 });
  });
});
