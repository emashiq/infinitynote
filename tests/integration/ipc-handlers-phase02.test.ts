import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import type { MainServices } from '../../src/main/main-services';
import { INVOKE_CHANNELS } from '../../src/shared/contracts/channel-names';
import { NOTE_TOO_LARGE_MESSAGE } from '../../src/shared/contracts/notes';
import { textToDoc } from '../../src/shared/text/textarea-doc';
import { setupServices } from './hierarchy-helpers';
import { catalogueRouter } from './ipc-helpers';

const appDeps: AppHandlerDeps = {
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

/** Every catalogue channel registered through registerIpcHandlers, as main does at startup. */
const routerOver = (services: MainServices | null) => catalogueRouter(services, appDeps);

async function setup() {
  const s = await setupServices();
  return { s, ...routerOver(s.services) };
}

const id = () => randomUUID();

describe('Phase 02 IPC handlers', () => {
  it('registers every catalogue channel', async () => {
    const { handlers } = await setup();
    expect([...handlers.keys()].sort()).toEqual([...INVOKE_CHANNELS].sort());
  });

  it('every new channel rejects extra keys, non-UUID ids and wrong types without calling the service', async () => {
    const { call, s } = await setup();
    const spies = [
      vi.spyOn(s.hierarchy, 'createProject'),
      vi.spyOn(s.hierarchy, 'renameProject'),
      vi.spyOn(s.hierarchy, 'createFolder'),
      vi.spyOn(s.hierarchy, 'renameFolder'),
      vi.spyOn(s.hierarchy, 'moveFolder'),
      vi.spyOn(s.hierarchy, 'createNote'),
      vi.spyOn(s.hierarchy, 'renameNote'),
      vi.spyOn(s.hierarchy, 'moveNote'),
      vi.spyOn(s.hierarchy, 'setPinned'),
      vi.spyOn(s.hierarchy, 'setFavorite'),
      vi.spyOn(s.trash, 'trashProject'),
      vi.spyOn(s.trash, 'trashFolder'),
      vi.spyOn(s.trash, 'trashNote'),
      vi.spyOn(s.trash, 'restore'),
      vi.spyOn(s.trash, 'purge'),
      vi.spyOn(s.home, 'summary'),
      vi.spyOn(s.sessions, 'set'),
      vi.spyOn(s.palette, 'searchTitles'),
      vi.spyOn(s.reader, 'open'),
      vi.spyOn(s.writer, 'save'),
    ];
    const root = { projectId: null, folderId: null };
    const froot = { projectId: null, parentId: null };
    const bad: Array<[string, unknown]> = [
      ['tree:list', { x: 1 }],
      ['project:create', { name: 'A', extra: 1 }],
      ['project:create', { name: 5 }],
      ['project:rename', { projectId: 'nope', name: 'A' }],
      ['project:rename', { projectId: id(), name: '' }],
      ['project:trash', { projectId: 'common' }],
      ['folder:create', { location: froot, name: 'A', extra: true }],
      ['folder:create', { location: { projectId: 'x', parentId: null }, name: 'A' }],
      ['folder:rename', { folderId: 'x', name: 'A' }],
      ['folder:move', { folderId: id(), target: { projectId: null } }],
      ['folder:trash', { folderId: 12 }],
      ['note:create', { location: root, sticky: 'yes' }],
      ['note:create', { location: root, sticky: false, extra: 1 }],
      ['note:rename', { noteId: id(), title: 'x'.repeat(201) }],
      ['note:move', { noteId: 'x', target: root }],
      ['note:trash', {}],
      ['note:setPinned', { noteId: id(), pinned: 1 }],
      ['item:setFavorite', { kind: 'tag', id: id(), favorite: true }],
      ['trash:list', { all: true }],
      ['trash:restore', { batchId: 'x' }],
      ['trash:purge', { target: { kind: 'all' } }],
      ['home:summary', { scope: { kind: 'project' } }],
      ['home:summary', { scope: { kind: 'all' }, extra: 1 }],
      ['session:get', { x: 1 }],
      ['session:set', { session: { version: 1, tabs: [], activeTabId: 'home' } }],
      ['palette:searchTitles', { query: 'x'.repeat(201) }],
      ['palette:searchTitles', { query: 'a', limit: 51 }],
      ['note:open', { noteId: 'x' }],
      ['note:save', { noteId: id() }],
      ['collab:join', { noteId: id(), viewId: 'v' }],
      ['collab:leave', { noteId: id() }],
    ];
    for (const [channel, payload] of bad) {
      const res = await call(channel, payload);
      expect(res, `${channel} ${JSON.stringify(payload)}`).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('create, rename, move, trash, restore and tree:list work through the router and broadcast events', async () => {
    const { call, s } = await setup();
    const project = (await call('project:create', { name: '  Alpha ' })).data.project;
    expect(project.name).toBe('Alpha');
    const folder = (await call('folder:create', { location: { projectId: project.id, parentId: null }, name: 'F' })).data.folder;
    const note = (await call('note:create', { location: { projectId: project.id, folderId: folder.id }, sticky: true })).data.note;
    expect(note).toMatchObject({ sticky: true, color: 'yellow' });
    expect(await call('note:rename', { noteId: note.id, title: 'Plan' })).toMatchObject({ ok: true });
    expect((await call('tree:list', {})).data.notes[0].title).toBe('Plan');
    expect(await call('note:setPinned', { noteId: note.id, pinned: true })).toMatchObject({ ok: true });
    expect((await call('home:summary', { scope: { kind: 'all' } })).data.pinned).toHaveLength(1);
    expect(await call('item:setFavorite', { kind: 'folder', id: folder.id, favorite: true })).toMatchObject({ ok: true, data: { favorite: true } });
    const moved = await call('note:move', { noteId: note.id, target: { projectId: null, folderId: null } });
    expect(moved.data.note).toMatchObject({ projectId: null, folderId: null });
    const trashed = await call('note:trash', { noteId: note.id });
    expect(trashed.data.counts).toEqual({ projects: 0, folders: 0, notes: 1, documents: 0 });
    expect(await call('note:open', { noteId: note.id })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', details: { trashed: true } } });
    const list = (await call('trash:list', {})).data.items;
    expect(list).toHaveLength(1);
    expect(await call('trash:restore', { batchId: list[0].batchId })).toMatchObject({ ok: true, data: { relocated: false } });
    expect(await call('palette:searchTitles', { query: 'pla' })).toMatchObject({ ok: true, data: { results: [{ id: note.id }] } });
    expect(await call('folder:move', { folderId: folder.id, target: { projectId: project.id, parentId: folder.id } })).toMatchObject({
      ok: false,
      error: { code: 'CYCLE' },
    });
    expect(s.events.map((e) => e.reason)).toEqual(['create', 'create', 'create', 'rename', 'pin', 'favorite', 'move', 'trash', 'restore']);
    s.check();
  });

  it('purge requires confirmation and works with it', async () => {
    const { call } = await setup();
    const note = (await call('note:create', { location: { projectId: null, folderId: null }, sticky: false })).data.note;
    await call('note:trash', { noteId: note.id });
    expect(await call('trash:purge', { target: { kind: 'all' } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await call('trash:purge', { target: { kind: 'all' }, confirmed: true })).toEqual({ ok: true, data: { purged: { projects: 0, folders: 0, notes: 1, documents: 0 } } });
  });

  it('settings: new keys have defaults and validate; session.tabs is unreachable', async () => {
    const { call, s } = await setup();
    const keys = ['layout.treeOpen', 'layout.treeWidth', 'layout.panelOpen', 'home.scope', 'tree.expanded'];
    expect(await call('settings:get', { keys })).toEqual({
      ok: true,
      data: { values: { 'layout.treeOpen': true, 'layout.treeWidth': 248, 'layout.panelOpen': false, 'home.scope': { kind: 'all' }, 'tree.expanded': ['common', 'projects'] } },
    });
    expect(await call('settings:set', { key: 'layout.treeWidth', value: 240 })).toMatchObject({ ok: true });
    expect(await call('settings:set', { key: 'layout.treeWidth', value: 300 })).toMatchObject({ ok: false });
    expect(await call('settings:get', { keys: ['session.tabs'] })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await call('settings:set', { key: 'session.tabs', value: {} })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(s.row<{ value: string }>("SELECT value FROM settings WHERE key = 'layout.treeWidth'")?.value).toBe('{"v":1,"value":240}');
  });

  it('note:save accepts a 4.9 MiB document and rejects larger ones', async () => {
    const { call, s } = await setup();
    const note = (await call('note:create', { location: { projectId: null, folderId: null }, sticky: false })).data.note;
    const viewId = id();
    const save = (text: string, base: number) =>
      call('note:save', { noteId: note.id, viewId, baseRevision: base, requestId: id(), format: 'rich', content: textToDoc(text) });
    const mib = 1024 * 1024;
    const okRes = await save('x'.repeat(Math.floor(4.9 * mib)), 0);
    expect(okRes).toMatchObject({ ok: true, data: { revision: 1 } });
    // Both the writer's content limit and the router's payload ceiling answer with the UX_SPEC copy (QA-1).
    const tooLarge = { ok: false, error: { code: 'LIMIT_EXCEEDED', message: NOTE_TOO_LARGE_MESSAGE } };
    expect(await save('x'.repeat(5 * mib + 1), 1)).toMatchObject(tooLarge);
    expect(await save('x'.repeat(5 * mib + 70_000), 1)).toMatchObject(tooLarge);
    expect(await save('x'.repeat(6 * mib), 1)).toMatchObject(tooLarge);
    expect(s.row<{ revision: number }>('SELECT revision FROM notes WHERE id = ?', note.id)?.revision).toBe(1);
  });

  it('session:get and session:set round-trip through the router', async () => {
    const { call } = await setup();
    const got = await call('session:get', {});
    expect(got).toMatchObject({ ok: true, data: { session: { tabs: [{ id: 'home' }] }, dropped: { trashed: 0, missing: 0, duplicates: 0 } } });
    const set = await call('session:set', { session: { version: 1, tabs: [{ id: 'home', kind: 'home' }, { id: 'page:settings', kind: 'settings' }], activeTabId: 'page:settings' } });
    expect(set.ok).toBe(true);
    expect((await call('session:get', {})).data.session.activeTabId).toBe('page:settings');
  });

  it('every storage channel reports storage-unavailable when the database failed to open; app channels still work', async () => {
    const { call } = routerOver(null);
    const unavailable = { ok: false, error: { code: 'INTERNAL', message: 'Storage is unavailable' } };
    const valid: Array<[string, unknown]> = [
      ['settings:get', { keys: ['appearance.theme'] }],
      ['settings:set', { key: 'appearance.theme', value: 'dark' }],
      ['tree:list', {}],
      ['project:create', { name: 'A' }],
      ['folder:create', { location: { projectId: null, parentId: null }, name: 'A' }],
      ['note:create', { location: { projectId: null, folderId: null }, sticky: false }],
      ['note:trash', { noteId: id() }],
      ['trash:list', {}],
      ['home:summary', { scope: { kind: 'all' } }],
      ['session:get', {}],
      ['palette:searchTitles', { query: 'a' }],
      ['note:open', { noteId: id() }],
      ['collab:join', { noteId: id(), viewId: id() }],
    ];
    for (const [channel, payload] of valid) expect(await call(channel, payload), channel).toEqual(unavailable);
    expect(await call('app:quit', {})).toEqual({ ok: true, data: {} });
  });
});
