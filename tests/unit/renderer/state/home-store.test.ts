import { describe, expect, it } from 'vitest';
import { makeNote, setupServices } from '../support/services';

describe('HomeStore (INF-HOME-03)', () => {
  it('loads the summary on init for the stored scope', async () => {
    const { services, fake } = await setupServices();
    expect(services.home.store.getState()).toMatchObject({ status: 'ready', scope: { kind: 'all' }, scopeValid: true });
    expect(fake.callsTo('home:summary')).toHaveLength(1);
  });

  it('setScope persists home.scope and refreshes', async () => {
    const { services, fake } = await setupServices();
    const p = await fake.bridge.project.create({ name: 'P' });
    if (!p.ok) throw new Error('p');
    await makeNote(fake, { projectId: p.data.project.id, folderId: null }, 'In P');
    await makeNote(fake, undefined, 'In Common');
    await services.home.setScope({ kind: 'project', projectId: p.data.project.id });
    expect(fake.callsTo('settings:set').at(-1)?.req).toEqual({ key: 'home.scope', value: { kind: 'project', projectId: p.data.project.id } });
    expect(services.home.store.getState().summary?.recent.map((n) => n.title)).toEqual(['In P']);
    await services.home.setScope({ kind: 'common' });
    expect(services.home.store.getState().summary?.recent.map((n) => n.title)).toEqual(['In Common']);
  });

  it('an invalid scope falls back to All and persists it', async () => {
    const { createFakeBridge } = await import('../support/fake-bridge');
    const fake = createFakeBridge();
    const ghost = '55555555-5555-4555-8555-555555555555';
    fake.data.settings.set('home.scope', { kind: 'project', projectId: ghost });
    const { services } = await setupServices({ fake });
    expect(services.home.store.getState()).toMatchObject({ scope: { kind: 'all' }, scopeValid: false });
    expect(fake.callsTo('settings:set').at(-1)?.req).toEqual({ key: 'home.scope', value: { kind: 'all' } });
  });

  it('a trashed project switches the filter to All', async () => {
    const { services, fake } = await setupServices();
    const p = await fake.bridge.project.create({ name: 'P' });
    if (!p.ok) throw new Error('p');
    await services.home.setScope({ kind: 'project', projectId: p.data.project.id });
    await fake.bridge.project.trash({ projectId: p.data.project.id });
    await services.home.refresh();
    expect(services.home.store.getState().scope).toEqual({ kind: 'all' });
    expect(fake.callsTo('settings:set').at(-1)?.req).toEqual({ key: 'home.scope', value: { kind: 'all' } });
  });

  it('refreshes on tree:changed and when the Home tab becomes active', async () => {
    const { services, fake } = await setupServices();
    const before = fake.callsTo('home:summary').length;
    await makeNote(fake, undefined, 'Fresh');
    await new Promise((r) => setTimeout(r, 0));
    await services.home.refresh();
    expect(fake.callsTo('home:summary').length).toBeGreaterThan(before);
    expect(services.home.store.getState().summary?.recent.map((n) => n.title)).toContain('Fresh');
    const note = await makeNote(fake, undefined, 'Tab');
    await services.tabs.openNote(note.id);
    const count = fake.callsTo('home:summary').length;
    await services.tabs.activate('home');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.callsTo('home:summary').length).toBeGreaterThan(count);
  });

  it('coalesces overlapping refreshes into one extra fetch', async () => {
    const { services, fake } = await setupServices();
    const base = fake.callsTo('home:summary').length;
    await Promise.all([services.home.refresh(), services.home.refresh(), services.home.refresh()]);
    expect(fake.callsTo('home:summary').length - base).toBe(2);
  });
});
