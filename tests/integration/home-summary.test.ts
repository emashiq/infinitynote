import { describe, expect, it } from 'vitest';
import { setupServices } from './hierarchy-helpers';

describe('home:summary (INF-HOME-02, INF-HOME-03)', () => {
  async function seeded() {
    const s = await setupServices();
    const p = s.project('P');
    const q = s.project('Q');
    const f = s.folder(p.id, null, 'F');
    const x = s.note(null, null, 'X');
    const y = s.note(p.id, f.id, 'Y');
    const z = s.note(q.id, null, 'Z');
    return { s, p, q, f, x, y, z };
  }

  it('All, Common and Project return the expected sets', async () => {
    const { s, p, q, x, y, z } = await seeded();
    const ids = (r: ReturnType<typeof s.home.summary>) => r.recent.map((n) => n.id).sort();
    expect(ids(s.home.summary({ kind: 'all' }))).toEqual([x.id, y.id, z.id].sort());
    expect(ids(s.home.summary({ kind: 'common' }))).toEqual([x.id]);
    expect(ids(s.home.summary({ kind: 'project', projectId: p.id }))).toEqual([y.id]);
    expect(ids(s.home.summary({ kind: 'project', projectId: q.id }))).toEqual([z.id]);
    expect(s.home.summary({ kind: 'all' })).toMatchObject({ scope: { kind: 'all' }, scopeValid: true });
  });

  it('computes paths for each note', async () => {
    const { s, x, y, z } = await seeded();
    const byId = new Map(s.home.summary({ kind: 'all' }).recent.map((n) => [n.id, n.path]));
    expect(byId.get(x.id)).toEqual(['Common']);
    expect(byId.get(y.id)).toEqual(['P', 'F']);
    expect(byId.get(z.id)).toEqual(['Q']);
  });

  it('orders recent by updated_at desc with a limit of 10', async () => {
    const s = await setupServices();
    const created: string[] = [];
    for (let i = 0; i < 12; i += 1) created.push(s.note(null, null, `n${i}`).id);
    const recent = s.home.summary({ kind: 'all' }).recent;
    expect(recent).toHaveLength(10);
    expect(recent.map((n) => n.id)).toEqual(created.slice(2).reverse());
    s.tick();
    s.hierarchy.renameNote(created[0]!, 'bumped');
    expect(s.home.summary({ kind: 'all' }).recent[0]?.id).toBe(created[0]);
  });

  it('orders pinned by pinned_at desc, limits to 100 and reports the total', async () => {
    const s = await setupServices();
    const ids: string[] = [];
    for (let i = 0; i < 103; i += 1) {
      const n = s.note(null, null, `n${i}`);
      ids.push(n.id);
      s.tick();
      s.hierarchy.setPinned(n.id, true);
    }
    const h = s.home.summary({ kind: 'common' });
    expect(h.pinnedTotal).toBe(103);
    expect(h.pinned).toHaveLength(100);
    expect(h.pinned[0]?.id).toBe(ids[102]);
    expect(h.pinned[99]?.id).toBe(ids[3]);
  });

  it('a trashed project gives scopeValid:false and the All scope', async () => {
    const { s, p, x, y, z } = await seeded();
    s.trash.trashProject(p.id);
    const h = s.home.summary({ kind: 'project', projectId: p.id });
    expect(h).toMatchObject({ scope: { kind: 'all' }, scopeValid: false });
    expect(h.recent.map((n) => n.id).sort()).toEqual([x.id, z.id].sort());
    expect(h.recent.some((n) => n.id === y.id)).toBe(false);
  });

  it('trashed notes are excluded from pinned and recent', async () => {
    const { s, x } = await seeded();
    s.hierarchy.setPinned(x.id, true);
    expect(s.home.summary({ kind: 'all' }).pinned.map((n) => n.id)).toEqual([x.id]);
    s.trash.trashNote(x.id);
    const h = s.home.summary({ kind: 'all' });
    expect(h.pinned).toEqual([]);
    expect(h.recent.some((n) => n.id === x.id)).toBe(false);
  });
});
