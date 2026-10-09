import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeNote, setupServices } from '../support/services';
import { typeInto } from '../support/editor-source';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const sets = (fake: Awaited<ReturnType<typeof setupServices>>['fake']) => fake.callsTo('settings:set').map((c) => c.req as { key: string; value: unknown });

describe('TreeStore', () => {
  it('loads the model with Common and Trash is empty', async () => {
    const { services } = await setupServices();
    const t = services.tree.store.getState();
    expect(t.status).toBe('ready');
    expect(t.model.roots).toEqual(['common', 'projects', 'trash']);
    expect(t.expanded).toEqual(new Set(['common', 'projects']));
  });

  it('coalesces overlapping reloads', async () => {
    const { services, fake } = await setupServices();
    const before = fake.callsTo('tree:list').length;
    await Promise.all([services.tree.reload(), services.tree.reload(), services.tree.reload()]);
    expect(fake.callsTo('tree:list').length - before).toBe(2);
  });

  it('creating a project expands and selects it, and persists expansion after 300 ms', async () => {
    const { services, fake } = await setupServices();
    const r = await services.tree.createProject('Alpha');
    if (!r.ok) throw new Error('create');
    const key = `project:${r.data.id}`;
    expect(services.tree.store.getState().selectedKey).toBe(key);
    expect(services.tree.store.getState().expanded.has(key)).toBe(true);
    expect(sets(fake).filter((s) => s.key === 'tree.expanded')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300);
    const stored = sets(fake).filter((s) => s.key === 'tree.expanded').at(-1);
    expect(stored?.value).toEqual(expect.arrayContaining(['common', 'projects', key]));
  });

  it('reveal expands every ancestor, also for favorite entries', async () => {
    const { services, fake } = await setupServices();
    const p = await services.tree.createProject('P');
    if (!p.ok) throw new Error('p');
    const f1 = await services.tree.createFolder({ projectId: p.data.id, parentId: null }, 'F1');
    if (!f1.ok) throw new Error('f1');
    const f2 = await services.tree.createFolder({ projectId: p.data.id, parentId: f1.data.id }, 'F2');
    if (!f2.ok) throw new Error('f2');
    const n = await services.tree.createNote({ projectId: p.data.id, folderId: f2.data.id }, { sticky: false, title: 'Deep' });
    if (!n.ok) throw new Error('n');
    services.tree.hydrate(['common']);
    services.tree.reveal(`note:${n.data.note.id}`);
    const s = services.tree.store.getState();
    for (const k of ['projects', `project:${p.data.id}`, `folder:${f1.data.id}`, `folder:${f2.data.id}`]) expect(s.expanded.has(k), k).toBe(true);
    expect(s.selectedKey).toBe(`note:${n.data.note.id}`);
    expect(fake.callsTo('note:create')).toHaveLength(1);
  });

  it('reports main errors as failed outcomes with the message', async () => {
    const { services, fake } = await setupServices();
    fake.failNext('folder:create', { code: 'LIMIT_EXCEEDED', message: 'Folders can be nested at most 32 levels deep.' });
    const r = await services.tree.createFolder({ projectId: null, parentId: null }, 'x');
    expect(r).toEqual({ ok: false, code: 'LIMIT_EXCEEDED', message: 'Folders can be nested at most 32 levels deep.' });
  });

  it('trash flushes the active note first', async () => {
    const { services, fake } = await setupServices();
    const a = await makeNote(fake, undefined, 'A');
    await services.tabs.openNote(a.id);
    await vi.advanceTimersByTimeAsync(0);
    typeInto(services.tabs.activeController()!, 'last words');
    const r = await services.tree.trashNote(a.id);
    expect(r.ok).toBe(true);
    const order = fake.calls.map((c) => c.channel).filter((c) => c === 'note:save' || c === 'note:trash');
    expect(order).toEqual(['note:save', 'note:trash']);
  });

  it('restore pushes the notice with and without relocation', async () => {
    const { services, fake } = await setupServices();
    const a = await makeNote(fake, undefined, 'A');
    const t = await services.tree.trashNote(a.id);
    if (!t.ok) throw new Error('t');
    const restored = await services.tree.restore(t.data.trashBatchId);
    expect(restored.ok).toBe(true);
    expect(services.notices.store.getState().notices.map((x) => x.text)).toEqual(['Restored to Common']);
    const relocated = { ...fake.bridge, trash: { ...fake.bridge.trash, restore: async () => ({ ok: true as const, data: { kind: 'note' as const, id: a.id, relocated: true, location: { projectId: null, folderId: null }, path: ['Alpha', 'L1'], restoredNoteIds: [a.id] } }) } };
    const { createAppServices } = await import('../../../../src/renderer/state/app-services');
    const s2 = createAppServices(relocated, { viewport: { width: () => 1280, onResize: () => () => undefined }, themeEnv: null, lifecycle: null });
    await s2.ready;
    await s2.tree.restore('66666666-6666-4666-8666-666666666666');
    expect(s2.notices.store.getState().notices.map((x) => x.text)).toEqual([
      'Restored to Alpha › L1 because its original location is in Trash or no longer exists',
    ]);
  });

  it('moveDestinations lists Common, its folders, then each project and folders, marking the current one', async () => {
    const { services } = await setupServices();
    const cf = await services.tree.createFolder({ projectId: null, parentId: null }, 'CF');
    const p = await services.tree.createProject('Proj');
    if (!cf.ok || !p.ok) throw new Error('setup');
    const pf = await services.tree.createFolder({ projectId: p.data.id, parentId: null }, 'PF');
    const sub = await services.tree.createFolder({ projectId: p.data.id, parentId: pf.ok ? pf.data.id : null }, 'Sub');
    if (!pf.ok || !sub.ok) throw new Error('setup2');
    const dest = services.tree.moveDestinations(`folder:${sub.data.id}`);
    expect(dest.map((d) => d.path.join(' > '))).toEqual(['Common', 'Common > CF', 'Proj', 'Proj > PF', 'Proj > PF > Sub']);
    expect(dest.filter((d) => d.current).map((d) => d.path.join(' > '))).toEqual(['Proj > PF']);
    const note = await services.tree.createNote({ projectId: null, folderId: cf.data.id }, { sticky: false, title: 'N' });
    if (!note.ok) throw new Error('note');
    const forNote = services.tree.moveDestinations(`note:${note.data.note.id}`);
    expect(forNote.filter((d) => d.current).map((d) => d.path.join(' > '))).toEqual(['Common > CF']);
    const moved = await services.tree.moveItem(`note:${note.data.note.id}`, dest.find((d) => d.path.join(' > ') === 'Proj > PF')!);
    expect(moved.ok).toBe(true);
    expect(services.tree.store.getState().snapshot.notes[0]).toMatchObject({ projectId: p.data.id, folderId: pf.data.id });
  });
});

describe('command runner (INF-KEY-01, INF-KEY-02, INF-HOME-03)', () => {
  it('note.new from Home with the Common filter creates in Common, opens a tab and requests title focus', async () => {
    const { services, fake } = await setupServices();
    await services.home.setScope({ kind: 'common' });
    await services.commands.run('note.new');
    const created = fake.callsTo('note:create')[0]?.req as { location: unknown; sticky: boolean };
    expect(created).toEqual({ location: { projectId: null, folderId: null }, sticky: false });
    const active = services.tabs.store.getState().session.activeTabId;
    expect(active).toMatch(/^note:/);
    expect(services.ui.store.getState().focusRequest).toEqual({ target: 'noteTitle', noteId: active.slice(5) });
  });

  it('sticky.new under a Project filter goes to the project root with sticky true and floats it without a tab (D-069)', async () => {
    const { services, fake } = await setupServices();
    const p = await fake.bridge.project.create({ name: 'P' });
    if (!p.ok) throw new Error('p');
    await services.home.setScope({ kind: 'project', projectId: p.data.project.id });
    await services.commands.run('sticky.new');
    expect(fake.callsTo('note:create')[0]?.req).toEqual({ location: { projectId: p.data.project.id, folderId: null }, sticky: true });
    const created = services.tree.store.getState().snapshot.notes[0]!;
    expect(created).toMatchObject({ sticky: true, color: 'yellow' });
    expect(fake.callsTo('sticky:float').map((c) => c.req)).toEqual([{ noteId: created.id }]);
    expect(services.tabs.store.getState().session.tabs.map((t) => t.kind)).toEqual(['home']);
  });

  it('note.float flushes the active note and floats it; a failure shows a notice', async () => {
    const { services, fake } = await setupServices();
    await services.commands.run('note.float');
    expect(fake.callsTo('sticky:float')).toEqual([]);
    const note = await makeNote(fake, undefined, 'Float me');
    await services.tabs.openNote(note.id);
    await services.commands.run('note.float');
    expect(fake.callsTo('sticky:float').map((c) => c.req)).toEqual([{ noteId: note.id }]);
    fake.failNext('sticky:float', { code: 'LIMIT_EXCEEDED', message: 'You have 50 open stickies. Hide some to open more.' });
    await services.commands.run('note.float');
    expect(services.notices.store.getState().notices.map((n) => n.text)).toContain('You have 50 open stickies. Hide some to open more.');
  });

  it('uses the open note location when a note tab is active, and the focused tree selection first', async () => {
    const { services, fake } = await setupServices();
    const folder = await services.tree.createFolder({ projectId: null, parentId: null }, 'L2');
    const other = await services.tree.createFolder({ projectId: null, parentId: null }, 'L3');
    if (!folder.ok || !other.ok) throw new Error('f');
    const note = await makeNote(fake, { projectId: null, folderId: folder.data.id }, 'In L2');
    await services.tree.reload();
    await services.tabs.openNote(note.id);
    await services.commands.run('note.new');
    expect(fake.callsTo('note:create').at(-1)?.req).toEqual({ location: { projectId: null, folderId: folder.data.id }, sticky: false });
    services.tree.select(`folder:${other.data.id}`);
    services.tree.setHasFocus(true);
    await services.commands.run('sticky.new');
    expect(fake.callsTo('note:create').at(-1)?.req).toEqual({ location: { projectId: null, folderId: other.data.id }, sticky: true });
    services.tree.setHasFocus(false);
    await services.tabs.openPage('settings');
    await services.commands.run('note.new');
    expect(fake.callsTo('note:create').at(-1)?.req).toEqual({ location: { projectId: null, folderId: null }, sticky: false });
  });

  it('shows the main error as a notice when creation fails', async () => {
    const { services, fake } = await setupServices();
    fake.failNext('note:create', { code: 'NOT_FOUND', message: 'That location is in Trash.' });
    await services.commands.run('note.new');
    expect(services.notices.store.getState().notices.map((n) => [n.text, n.tone])).toEqual([['That location is in Trash.', 'error']]);
    expect(services.tabs.store.getState().session.tabs).toHaveLength(1);
  });

  it('folder.new opens the dialog with a folder target derived from the location', async () => {
    const { services } = await setupServices();
    const f = await services.tree.createFolder({ projectId: null, parentId: null }, 'F');
    if (!f.ok) throw new Error('f');
    await services.commands.run('folder.new');
    expect(services.ui.store.getState().dialog).toEqual({ kind: 'newFolder', target: { projectId: null, parentId: null } });
    services.tree.select(`folder:${f.data.id}`);
    services.tree.setHasFocus(true);
    await services.commands.run('folder.new');
    expect(services.ui.store.getState().dialog).toEqual({ kind: 'newFolder', target: { projectId: null, parentId: f.data.id } });
  });

  it('go, view, tab and palette commands', async () => {
    const { services } = await setupServices();
    await services.commands.run('go.settings');
    await services.commands.run('go.stickies');
    await services.commands.run('go.reminders');
    await services.commands.run('go.settings');
    expect(services.tabs.store.getState().session.tabs.map((t) => t.id)).toEqual(['home', 'page:settings', 'page:stickies', 'page:reminders']);
    expect(services.tabs.store.getState().session.activeTabId).toBe('page:settings');
    await services.commands.run('tab.next');
    expect(services.tabs.store.getState().session.activeTabId).toBe('page:stickies');
    await services.commands.run('tab.prev');
    await services.commands.run('tab.close');
    expect(services.tabs.store.getState().session.tabs.map((t) => t.id)).toEqual(['home', 'page:stickies', 'page:reminders']);
    await services.commands.run('go.home');
    await services.commands.run('tab.close');
    expect(services.tabs.store.getState().session.tabs).toHaveLength(3);
    await services.commands.run('view.toggleTree');
    expect(services.layout.store.getState().treeOpen).toBe(false);
    // The details panel starts closed (D-102): the toggle opens it.
    expect(services.layout.store.getState().panelOpen).toBe(false);
    await services.commands.run('view.togglePanel');
    expect(services.layout.store.getState().panelOpen).toBe(true);
    await services.commands.run('palette.open');
    expect(services.ui.store.getState().paletteOpen).toBe(true);
    await services.commands.run('project.new');
    expect(services.ui.store.getState().dialog).toEqual({ kind: 'newProject' });
  });
});

describe('app services', () => {
  it('hydrates stored settings and follows settings:changed for the theme', async () => {
    const { createFakeBridge } = await import('../support/fake-bridge');
    const fake = createFakeBridge();
    fake.data.settings.set('layout.treeWidth', 260);
    fake.data.settings.set('layout.panelOpen', true);
    fake.data.settings.set('appearance.theme', 'dark');
    const { services } = await setupServices({ fake });
    expect(services.layout.store.getState()).toMatchObject({ treeWidth: 260, panelOpen: true });
    expect(services.theme.store.getState().value).toBe('dark');
    expect(services.meta.getState().info?.version).toBe('0.1.0');
    fake.emit('settings:changed', { key: 'appearance.theme', value: 'light', updatedAt: 1 });
    expect(services.theme.store.getState().value).toBe('light');
  });

  it('resizing the viewport updates the layout modes', async () => {
    const { services, resize } = await setupServices({ width: 1280 });
    resize(900);
    expect(services.layout.store.getState()).toMatchObject({ treeMode: 'drawer', panelMode: 'drawer' });
  });

  it('re-samples the viewport width when ready resolves (narrow startup reading)', async () => {
    const fake = (await import('../support/fake-bridge')).createFakeBridge();
    let width = 600;
    const { createAppServices } = await import('../../../../src/renderer/state/app-services');
    const services = createAppServices(fake.bridge, {
      viewport: { width: () => width, onResize: () => () => undefined },
      themeEnv: null,
      lifecycle: null,
    });
    expect(services.layout.store.getState().treeMode).toBe('drawer');
    width = 1280; // the real width settles while init is in flight and no resize event arrives
    await services.ready;
    expect(services.layout.store.getState()).toMatchObject({ treeMode: 'docked', panelMode: 'docked', viewportWidth: 1280 });
  });

  it('dispose flushes the active note and releases its lease', async () => {
    const { services, fake } = await setupServices();
    const note = await makeNote(fake, undefined, 'A');
    await services.tabs.openNote(note.id);
    await vi.advanceTimersByTimeAsync(0);
    typeInto(services.tabs.activeController()!, 'kept');
    await services.dispose();
    expect(JSON.stringify(fake.data.notes[0]!.content)).toContain('kept');
    expect(fake.data.leases.size).toBe(0);
  });
});
