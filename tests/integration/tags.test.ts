import { describe, expect, it } from 'vitest';
import { MAX_TAGS_PER_NOTE, normalizeTag, TagsSetRequest } from '../../src/shared/contracts/tags';
import { thrown } from './hierarchy-helpers';
import { setupReminders } from './reminder-helpers';

describe('tags (INF-HIER-11, D-098)', () => {
  it('normalizes tags: trimmed, lower case, spaces as dashes, at most 32 characters, no "#" or commas', () => {
    expect(normalizeTag('  #Work ')).toBe('work');
    expect(normalizeTag('Q4 Plan')).toBe('q4-plan');
    expect(normalizeTag('বাংলা')).toBe('বাংলা');
    for (const bad of ['', '   ', '#', 'a,b', 'x'.repeat(33), 'tab\there\u0001']) expect(normalizeTag(bad), bad).toBeNull();
  });

  it('the contract accepts only normalized tags and at most 20 per note', () => {
    const noteId = '00000000-0000-4000-8000-000000000001';
    expect(TagsSetRequest.safeParse({ noteId, tags: ['work'] }).success).toBe(true);
    expect(TagsSetRequest.safeParse({ noteId, tags: ['Work'] }).success).toBe(false);
    expect(TagsSetRequest.safeParse({ noteId, tags: ['two words'] }).success).toBe(false);
    expect(TagsSetRequest.safeParse({ noteId, tags: Array.from({ length: MAX_TAGS_PER_NOTE + 1 }, (_, i) => `t${i}`) }).success).toBe(false);
  });

  it('sets, lists with live counts, drops unused tags and refuses a trashed note', async () => {
    const s = await setupReminders();
    const a = s.editable('A').note;
    const b = s.editable('B').note;
    expect(s.tags.set(a.id, ['work', 'q4', 'work'])).toEqual({ tags: ['q4', 'work'] });
    s.tags.set(b.id, ['work']);
    expect(s.tags.list(a.id)).toEqual({ tags: [{ name: 'q4', count: 1 }, { name: 'work', count: 1 }] });
    expect(s.tags.list()).toEqual({ tags: [{ name: 'q4', count: 1 }, { name: 'work', count: 2 }] });

    const { trashBatchId } = s.trash.trashNote(b.id);
    expect(s.tags.list()).toEqual({ tags: [{ name: 'q4', count: 1 }, { name: 'work', count: 1 }] });
    expect(thrown(() => s.tags.set(b.id, ['x'])).code).toBe('NOT_FOUND');
    s.trash.restore(trashBatchId);

    s.tags.set(a.id, []);
    expect(s.tags.list()).toEqual({ tags: [{ name: 'work', count: 1 }] });
    expect(s.rows('SELECT name FROM tags')).toEqual([{ name: 'work' }]);
  });
});
