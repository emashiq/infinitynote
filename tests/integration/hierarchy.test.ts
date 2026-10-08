import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CHANNEL_SCHEMAS } from '../../src/shared/contracts/channels';
import { livePathIndex } from '../../src/main/services/dto';
import { prng, setupServices, thrown } from './hierarchy-helpers';

describe('Common and projects (INF-HIER-01, INF-HIER-02)', () => {
  it('Common cannot be addressed by project:rename or project:trash', async () => {
    for (const bad of [null, 'common', '']) {
      expect(CHANNEL_SCHEMAS['project:rename'].request.safeParse({ projectId: bad, name: 'X' }).success).toBe(false);
      expect(CHANNEL_SCHEMAS['project:trash'].request.safeParse({ projectId: bad }).success).toBe(false);
    }
  });

  it('notes, stickies and folders can be created at the Common root and in Common folders', async () => {
    const s = await setupServices();
    const f = s.folder(null, null, 'Inbox');
    const n1 = s.note(null, null, 'root note');
    const n2 = s.note(null, f.id, 'in folder', true);
    expect(s.row<{ project_id: string | null; folder_id: string | null }>('SELECT project_id, folder_id FROM notes WHERE id = ?', n1.id)).toEqual({ project_id: null, folder_id: null });
    expect(s.row<{ project_id: string | null; folder_id: string | null }>('SELECT project_id, folder_id FROM notes WHERE id = ?', n2.id)).toEqual({ project_id: null, folder_id: f.id });
  });

  it('project CRUD: create, trim, keep Bangla, rename, trash with counts, NOT_FOUND after trash', async () => {
    const s = await setupServices();
    const p = s.project('  প্রকল্প  ');
    expect(p.name).toBe('প্রকল্প');
    expect(p.favorite).toBe(false);
    s.tick();
    expect(s.hierarchy.renameProject(p.id, ' Alpha ').project.name).toBe('Alpha');
    expect(s.row<{ name: string }>('SELECT name FROM projects WHERE id = ?', p.id)?.name).toBe('Alpha');
    const f = s.folder(p.id, null, 'F');
    s.note(p.id, f.id, 'a');
    s.note(p.id, null, 'b');
    s.tick();
    const trashed = s.trash.trashProject(p.id);
    expect(trashed.counts).toEqual({ projects: 1, folders: 1, notes: 2 });
    expect(trashed.trashedNoteIds).toHaveLength(2);
    s.check();
    expect(thrown(() => s.hierarchy.renameProject(p.id, 'Again'))).toMatchObject({ code: 'NOT_FOUND' });
    expect(thrown(() => s.trash.trashProject(p.id))).toMatchObject({ code: 'NOT_FOUND' });
    expect(s.hierarchy.list()).toEqual({ projects: [], folders: [], notes: [] });
  });

  it('rejects empty, too long and control-character names without writing', async () => {
    const s = await setupServices();
    for (const bad of ['', '   ', 'x'.repeat(201), 'a\u0007b']) {
      expect(thrown(() => s.hierarchy.createProject(bad)).code, JSON.stringify(bad)).toBe('VALIDATION_FAILED');
    }
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM projects')?.n).toBe(0);
    expect(s.events).toHaveLength(0);
  });
});

describe('folders and depth (INF-HIER-03)', () => {
  for (const scope of ['common', 'project'] as const) {
    it(`a chain of 32 folders succeeds and the 33rd is refused (${scope})`, async () => {
      const s = await setupServices();
      const pid = scope === 'project' ? s.project('P').id : null;
      let parent: string | null = null;
      let last = '';
      for (let i = 1; i <= 32; i += 1) {
        last = s.folder(pid, parent, `L${i}`).id;
        parent = last;
      }
      const before = s.row<{ n: number }>('SELECT count(*) AS n FROM folders')?.n;
      expect(thrown(() => s.hierarchy.createFolder({ projectId: pid, parentId: last }, 'L33'))).toEqual({
        code: 'LIMIT_EXCEEDED',
        message: 'Folders can be nested at most 32 levels deep.',
        details: undefined,
      });
      expect(s.row<{ n: number }>('SELECT count(*) AS n FROM folders')?.n).toBe(before);
    });
  }

  it('moving a subtree that would exceed depth 32 is refused', async () => {
    const s = await setupServices();
    let parent: string | null = null;
    for (let i = 1; i <= 31; i += 1) parent = s.folder(null, parent, `L${i}`).id;
    const a = s.folder(null, null, 'A');
    s.folder(null, a.id, 'A1');
    expect(thrown(() => s.hierarchy.moveFolder(a.id, { projectId: null, parentId: parent }))).toMatchObject({ code: 'LIMIT_EXCEEDED' });
    s.check();
  });

  it('rename and trash of nested folders', async () => {
    const s = await setupServices();
    const p = s.project('Alpha');
    const l1 = s.folder(p.id, null, 'L1');
    const l2 = s.folder(p.id, l1.id, 'L2');
    const l3 = s.folder(p.id, l2.id, 'L3');
    s.tick();
    expect(s.hierarchy.renameFolder(l2.id, 'L2b').folder.name).toBe('L2b');
    s.trash.trashFolder(l3.id);
    expect(s.hierarchy.list().folders.map((f) => f.name).sort()).toEqual(['L1', 'L2b']);
    expect(thrown(() => s.hierarchy.renameFolder(l3.id, 'x'))).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('notes at root and in folders, stickies (INF-HIER-04, INF-HIER-05)', () => {
  it('creates notes at the project root and in project folders with consistent project ids', async () => {
    const s = await setupServices();
    const p = s.project('P');
    const f = s.folder(p.id, null, 'F');
    const root = s.note(p.id, null, 'r');
    const inF = s.note(p.id, f.id, 'i');
    expect(root).toMatchObject({ projectId: p.id, folderId: null, revision: 0, sticky: false, color: null });
    expect(inF).toMatchObject({ projectId: p.id, folderId: f.id });
    expect(s.row<{ content_json: string; plain_text: string; format: string }>('SELECT content_json, plain_text, format FROM notes WHERE id = ?', inF.id)).toEqual({
      content_json: '{"type":"doc","content":[{"type":"paragraph"}]}',
      plain_text: '',
      format: 'rich',
    });
  });

  it('rejects folders from another scope and trashed or missing locations', async () => {
    const s = await setupServices();
    const p = s.project('P');
    const q = s.project('Q');
    const fp = s.folder(p.id, null, 'F');
    const fc = s.folder(null, null, 'C');
    expect(thrown(() => s.hierarchy.createNote({ projectId: q.id, folderId: fp.id }, false)).code).toBe('VALIDATION_FAILED');
    expect(thrown(() => s.hierarchy.createNote({ projectId: null, folderId: fp.id }, false)).message).toBe('That folder belongs to a different scope.');
    expect(thrown(() => s.hierarchy.createFolder({ projectId: p.id, parentId: fc.id }, 'x')).code).toBe('VALIDATION_FAILED');
    s.trash.trashFolder(fp.id);
    expect(thrown(() => s.hierarchy.createNote({ projectId: p.id, folderId: fp.id }, false))).toMatchObject({ code: 'NOT_FOUND', message: 'That location is in Trash.' });
    s.trash.trashProject(q.id);
    expect(thrown(() => s.hierarchy.createNote({ projectId: q.id, folderId: null }, false))).toMatchObject({ code: 'NOT_FOUND', message: 'That location is in Trash.' });
    expect(thrown(() => s.hierarchy.createNote({ projectId: randomUUID(), folderId: null }, false))).toMatchObject({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
    s.check();
  });

  it('stickies in all four location kinds keep the flag and yellow color, also after a move', async () => {
    const s = await setupServices();
    const p = s.project('P');
    const pf = s.folder(p.id, null, 'PF');
    const cf = s.folder(null, null, 'CF');
    const list = [s.note(null, null, '', true), s.note(null, cf.id, '', true), s.note(p.id, null, '', true), s.note(p.id, pf.id, '', true)];
    for (const n of list) {
      expect(n).toMatchObject({ sticky: true, color: 'yellow' });
      const row = s.row<{ sticky_enabled: number; color: string }>('SELECT sticky_enabled, color FROM notes WHERE id = ?', n.id);
      expect(row).toEqual({ sticky_enabled: 1, color: 'yellow' });
    }
    s.tick();
    const moved = s.hierarchy.moveNote(list[0]!.id, { projectId: p.id, folderId: pf.id }).note;
    expect(moved).toMatchObject({ sticky: true, color: 'yellow', projectId: p.id, folderId: pf.id });
    s.check();
  });
});

describe('duplicate names (INF-HIER-06)', () => {
  it('allows duplicates with distinct ids and disambiguates paths', async () => {
    const s = await setupServices();
    const w1 = s.project('Work');
    const w2 = s.project('Work');
    expect(w1.id).not.toBe(w2.id);
    const a = s.folder(w1.id, null, 'Specs');
    const b = s.folder(w1.id, null, 'Specs');
    const n1 = s.note(w1.id, a.id, 'Plan');
    const n2 = s.note(w1.id, b.id, 'Plan');
    const idx = livePathIndex(s.repo);
    expect(idx.get(w1.id)).toEqual(['Work']);
    expect(idx.get(w2.id)).toEqual(['Work (2)']);
    expect(idx.get(a.id)).toEqual(['Work', 'Specs']);
    expect(idx.get(b.id)).toEqual(['Work', 'Specs (2)']);
    const found = s.palette.searchTitles('plan').results;
    expect(found.map((r) => r.id).sort()).toEqual([n1.id, n2.id].sort());
    expect(new Set(found.map((r) => r.path.join('/'))).size).toBe(2);
  });
});

describe('moves (INF-HIER-07, INF-HIER-08)', () => {
  async function tree() {
    const s = await setupServices();
    const p = s.project('P');
    const q = s.project('Q');
    const f = s.folder(p.id, null, 'F');
    const g = s.folder(p.id, f.id, 'G');
    const live = s.note(p.id, f.id, 'live');
    const deep = s.note(p.id, g.id, 'deep');
    const gone = s.note(p.id, g.id, 'gone');
    s.tick();
    s.trash.trashNote(gone.id);
    const cf = s.folder(null, null, 'CF');
    return { s, p, q, f, g, live, deep, gone, cf };
  }

  it('moves a subtree across scopes, updating trashed rows too, and keeps every invariant', async () => {
    const { s, p, q, f, g, gone, cf } = await tree();
    s.events.length = 0;
    const r1 = s.hierarchy.moveFolder(f.id, { projectId: null, parentId: cf.id });
    expect(r1.movedFolders).toBe(2);
    expect(r1.movedNotes).toBe(3);
    s.check();
    for (const id of [f.id, g.id]) {
      expect(s.row<{ project_id: string | null }>('SELECT project_id FROM folders WHERE id = ?', id)?.project_id).toBeNull();
    }
    expect(s.row<{ project_id: string | null; folder_id: string }>('SELECT project_id, folder_id FROM notes WHERE id = ?', gone.id)).toEqual({ project_id: null, folder_id: g.id });
    expect(s.row<{ parent_id: string }>('SELECT parent_id FROM folders WHERE id = ?', f.id)?.parent_id).toBe(cf.id);
    s.tick();
    s.hierarchy.moveFolder(f.id, { projectId: q.id, parentId: null });
    s.check();
    expect(s.rows<{ project_id: string }>('SELECT project_id FROM notes WHERE folder_id IN (?, ?)', f.id, g.id).every((r) => r.project_id === q.id)).toBe(true);
    expect(s.rows<{ project_id: string }>('SELECT project_id FROM folders WHERE id IN (?, ?)', f.id, g.id).every((r) => r.project_id === q.id)).toBe(true);
    expect(s.events.map((e) => e.reason)).toEqual(['move', 'move']);
    expect(p.id).not.toBe(q.id);
  });

  it('moves a note across scopes', async () => {
    const { s, q, live } = await tree();
    const moved = s.hierarchy.moveNote(live.id, { projectId: q.id, folderId: null }).note;
    expect(moved).toMatchObject({ projectId: q.id, folderId: null });
    s.check();
    expect(thrown(() => s.hierarchy.moveNote(live.id, { projectId: null, folderId: randomUUID() })).code).toBe('NOT_FOUND');
  });

  it('a failing statement mid-move rolls everything back (subtree move atomic)', async () => {
    const { s, q, f, g, deep } = await tree();
    const snapshot = () => ({
      folders: s.rows('SELECT id, project_id, parent_id, updated_at FROM folders ORDER BY id'),
      notes: s.rows('SELECT id, project_id, folder_id FROM notes ORDER BY id'),
    });
    const before = snapshot();
    s.t.db.exec("CREATE TEMP TRIGGER boom BEFORE UPDATE OF project_id ON notes BEGIN SELECT RAISE(ABORT, 'boom'); END");
    s.events.length = 0;
    expect(thrown(() => s.hierarchy.moveFolder(f.id, { projectId: q.id, parentId: null }))).toMatchObject({ code: 'INTERNAL', message: 'Something went wrong' });
    s.t.db.exec('DROP TRIGGER boom');
    expect(snapshot()).toEqual(before);
    expect(s.events).toHaveLength(0);
    expect(deep.id).toBeTruthy();
    expect(g.id).toBeTruthy();
    s.check();
  });

  it('rejects moving a folder into itself, its child or its grandchild with CYCLE and changes nothing', async () => {
    const s = await setupServices();
    const a = s.folder(null, null, 'A');
    const b = s.folder(null, a.id, 'B');
    const c = s.folder(null, b.id, 'C');
    const before = s.rows('SELECT id, parent_id, project_id, updated_at FROM folders ORDER BY id');
    for (const target of [a.id, b.id, c.id]) {
      expect(thrown(() => s.hierarchy.moveFolder(a.id, { projectId: null, parentId: target }))).toMatchObject({
        code: 'CYCLE',
        message: 'A folder cannot be moved into itself or one of its subfolders.',
      });
    }
    expect(s.rows('SELECT id, parent_id, project_id, updated_at FROM folders ORDER BY id')).toEqual(before);
    s.check();
  });

  it('a no-op move changes nothing and broadcasts nothing', async () => {
    const s = await setupServices();
    const a = s.folder(null, null, 'A');
    const b = s.folder(null, a.id, 'B');
    s.events.length = 0;
    s.tick();
    const r = s.hierarchy.moveFolder(b.id, { projectId: null, parentId: a.id });
    expect(r).toMatchObject({ movedFolders: 0, movedNotes: 0 });
    expect(s.events).toHaveLength(0);
    expect(s.row<{ updated_at: number }>('SELECT updated_at FROM folders WHERE id = ?', b.id)?.updated_at).toBe(r.folder.updatedAt);
  });

  it('refuses scope mismatches and trashed targets', async () => {
    const s = await setupServices();
    const p = s.project('P');
    const a = s.folder(null, null, 'A');
    const pf = s.folder(p.id, null, 'PF');
    expect(thrown(() => s.hierarchy.moveFolder(a.id, { projectId: null, parentId: pf.id })).code).toBe('VALIDATION_FAILED');
    s.trash.trashFolder(pf.id);
    expect(thrown(() => s.hierarchy.moveFolder(a.id, { projectId: p.id, parentId: pf.id })).code).toBe('NOT_FOUND');
    s.trash.trashProject(p.id);
    expect(thrown(() => s.hierarchy.moveFolder(a.id, { projectId: p.id, parentId: null }))).toMatchObject({ code: 'NOT_FOUND', message: 'That location is in Trash.' });
  });
});

describe('rename, pin and favorite side effects', () => {
  it('rename and pin never change revision; pin and favorite never change updated_at', async () => {
    const s = await setupServices();
    const n = s.note(null, null, 'T');
    s.tick();
    const viewId = randomUUID();
    const lease = s.leases.acquire(n.id, viewId, 1);
    expect(lease.granted).toBe(true);
    if (!lease.granted) throw new Error('no lease');
    s.writer.save(
      { noteId: n.id, viewId, leaseToken: lease.leaseToken, baseRevision: 0, requestId: randomUUID(), format: 'rich', content: { type: 'doc', content: [{ type: 'paragraph' }] } },
      { webContentsId: 1 },
    );
    const afterSave = s.row<{ revision: number; updated_at: number }>('SELECT revision, updated_at FROM notes WHERE id = ?', n.id)!;
    expect(afterSave.revision).toBe(1);
    s.tick();
    s.hierarchy.renameNote(n.id, 'Renamed');
    const afterRename = s.row<{ revision: number; updated_at: number; title: string }>('SELECT revision, updated_at, title FROM notes WHERE id = ?', n.id)!;
    expect(afterRename).toMatchObject({ revision: 1, title: 'Renamed' });
    expect(afterRename.updated_at).toBeGreaterThan(afterSave.updated_at);
    s.tick();
    s.hierarchy.setPinned(n.id, true);
    s.hierarchy.setFavorite('note', n.id, true);
    const afterPin = s.row<{ revision: number; updated_at: number; pinned_at: number; favorite: number }>('SELECT revision, updated_at, pinned_at, favorite FROM notes WHERE id = ?', n.id)!;
    expect(afterPin.revision).toBe(1);
    expect(afterPin.updated_at).toBe(afterRename.updated_at);
    expect(afterPin.pinned_at).not.toBeNull();
    expect(afterPin.favorite).toBe(1);
    const p = s.project('P');
    const f = s.folder(p.id, null, 'F');
    const before = s.row<{ updated_at: number }>('SELECT updated_at FROM projects WHERE id = ?', p.id)!;
    s.tick();
    s.hierarchy.setFavorite('project', p.id, true);
    s.hierarchy.setFavorite('folder', f.id, true);
    expect(s.row<{ updated_at: number; favorite: number }>('SELECT updated_at, favorite FROM projects WHERE id = ?', p.id)).toEqual({ updated_at: before.updated_at, favorite: 1 });
    expect(s.hierarchy.list().folders[0]?.favorite).toBe(true);
    s.hierarchy.setPinned(n.id, false);
    expect(s.hierarchy.list().notes[0]?.pinnedAt).toBeNull();
  });

  it('pin and favorite on trashed or missing items give NOT_FOUND', async () => {
    const s = await setupServices();
    const n = s.note(null, null, 'T');
    s.trash.trashNote(n.id);
    expect(thrown(() => s.hierarchy.setPinned(n.id, true)).code).toBe('NOT_FOUND');
    expect(thrown(() => s.hierarchy.setFavorite('note', n.id, true)).code).toBe('NOT_FOUND');
    expect(thrown(() => s.hierarchy.setFavorite('folder', randomUUID(), true)).code).toBe('NOT_FOUND');
    expect(thrown(() => s.hierarchy.renameNote(n.id, 'x')).code).toBe('NOT_FOUND');
  });
});

describe('randomized operations keep the invariants', () => {
  it('400 seeded operations across 3 projects end with a healthy database and FTS', async () => {
    const s = await setupServices();
    const rnd = prng(20261008);
    const spies = {
      restore: vi.spyOn(s.trash, 'restore'),
      purge: vi.spyOn(s.trash, 'purge'),
      trashFolder: vi.spyOn(s.trash, 'trashFolder'),
      moveFolder: vi.spyOn(s.hierarchy, 'moveFolder'),
      moveNote: vi.spyOn(s.hierarchy, 'moveNote'),
    };
    const pick = <T>(arr: T[]): T | undefined => arr[Math.floor(rnd() * arr.length)];
    const projects = [s.project('P1').id, s.project('P2').id, s.project('P3').id];
    const scopes: Array<string | null> = [null, ...projects];
    const ok = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (!['NOT_FOUND', 'CYCLE', 'LIMIT_EXCEEDED', 'VALIDATION_FAILED'].includes(code ?? '')) throw err;
      }
      s.check();
    };
    for (let i = 0; i < 400; i += 1) {
      s.tick();
      const op = Math.floor(rnd() * 100);
      const live = s.hierarchy.list();
      const trashItems = s.trash.list().items;
      if (op < 22) {
        const scope = pick(scopes)!;
        const parent = pick(live.folders.filter((f) => f.projectId === scope));
        ok(() => s.hierarchy.createFolder({ projectId: scope, parentId: rnd() < 0.3 ? null : (parent?.id ?? null) }, `f${i}`));
      } else if (op < 42) {
        const scope = pick(scopes)!;
        const folder = pick(live.folders.filter((f) => f.projectId === scope));
        ok(() => s.hierarchy.createNote({ projectId: scope, folderId: rnd() < 0.3 ? null : (folder?.id ?? null) }, rnd() < 0.2, `n${i} ক`));
      } else if (op < 57) {
        const f = pick(live.folders);
        const scope = pick(scopes)!;
        const parent = pick(live.folders.filter((x) => x.projectId === scope));
        if (f) ok(() => s.hierarchy.moveFolder(f.id, { projectId: scope, parentId: rnd() < 0.3 ? null : (parent?.id ?? null) }));
      } else if (op < 67) {
        const n = pick(live.notes);
        const scope = pick(scopes)!;
        const folder = pick(live.folders.filter((x) => x.projectId === scope));
        if (n) ok(() => s.hierarchy.moveNote(n.id, { projectId: scope, folderId: rnd() < 0.3 ? null : (folder?.id ?? null) }));
      } else if (op < 77) {
        const f = pick(live.folders);
        if (f) ok(() => s.trash.trashFolder(f.id));
      } else if (op < 81) {
        const n = pick(live.notes);
        if (n) ok(() => s.trash.trashNote(n.id));
      } else if (op < 83) {
        const p = pick(live.projects);
        if (p) ok(() => s.trash.trashProject(p.id));
      } else if (op < 93) {
        const item = pick(trashItems);
        if (item) ok(() => s.trash.restore(item.batchId));
      } else if (op < 97) {
        const item = pick(trashItems);
        if (item) ok(() => s.trash.purge({ target: { kind: 'batch', batchId: item.batchId }, confirmed: true }));
      } else {
        const p = s.hierarchy.list().projects.length;
        if (p < 3) ok(() => s.hierarchy.createProject(`P${i}`));
      }
    }
    s.check();
    for (const [name, spy] of Object.entries(spies)) expect(spy.mock.calls.length, name).toBeGreaterThan(5);
    s.t.db.exec("INSERT INTO notes_fts(notes_fts) VALUES('integrity-check')");
    const live = s.row<{ n: number }>('SELECT count(*) AS n FROM notes WHERE deleted_at IS NULL')?.n;
    const indexed = s.row<{ n: number }>("SELECT count(*) AS n FROM notes_fts WHERE notes_fts MATCH 'n*'")?.n;
    expect(indexed).toBe(live);
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM notes')?.n).toBeGreaterThan(0);
  });
});
