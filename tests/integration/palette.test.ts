import { describe, expect, it } from 'vitest';
import { setupServices } from './hierarchy-helpers';

describe('palette:searchTitles (INF-KEY-03)', () => {
  it('puts prefix matches before substring matches, each by recency', async () => {
    const s = await setupServices();
    const sub = s.note(null, null, 'My plan');
    const pre1 = s.note(null, null, 'Plan A');
    const pre2 = s.note(null, null, 'plan b');
    const none = s.note(null, null, 'Other');
    const ids = s.palette.searchTitles('plan').results.map((r) => r.id);
    expect(ids).toEqual([pre2.id, pre1.id, sub.id]);
    expect(ids).not.toContain(none.id);
  });

  it('is case-insensitive including accents and matches Bangla substrings', async () => {
    const s = await setupServices();
    const e = s.note(null, null, 'École');
    const b = s.note(null, null, 'নোট বাংলা');
    expect(s.palette.searchTitles('école').results.map((r) => r.id)).toEqual([e.id]);
    expect(s.palette.searchTitles('ÉCOLE').results.map((r) => r.id)).toEqual([e.id]);
    expect(s.palette.searchTitles('বাং').results.map((r) => r.id)).toEqual([b.id]);
  });

  it('treats % and _ as literal characters', async () => {
    const s = await setupServices();
    const pct = s.note(null, null, '100% done');
    const under = s.note(null, null, 'snake_case');
    s.note(null, null, 'abc');
    expect(s.palette.searchTitles('%').results.map((r) => r.id)).toEqual([pct.id]);
    expect(s.palette.searchTitles('_').results.map((r) => r.id)).toEqual([under.id]);
    expect(s.palette.searchTitles('sn_k').results).toEqual([]);
  });

  it('matches untitled notes by the word untitled, and returns nothing for an empty query', async () => {
    const s = await setupServices();
    const n = s.note(null, null, '');
    expect(s.palette.searchTitles('untitled').results.map((r) => r.id)).toEqual([n.id]);
    expect(s.palette.searchTitles('').results).toEqual([]);
    expect(s.palette.searchTitles('   ').results).toEqual([]);
  });

  it('excludes trashed notes, applies the limit and returns paths', async () => {
    const s = await setupServices();
    const p = s.project('P');
    const f = s.folder(p.id, null, 'F');
    const gone = s.note(null, null, 'item gone');
    for (let i = 0; i < 25; i += 1) s.note(p.id, f.id, `item ${i}`);
    s.trash.trashNote(gone.id);
    const all = s.palette.searchTitles('item');
    expect(all.results).toHaveLength(20);
    expect(all.results.some((r) => r.id === gone.id)).toBe(false);
    expect(all.results[0]?.path).toEqual(['P', 'F']);
    expect(s.palette.searchTitles('item', 5).results).toHaveLength(5);
  });
});
