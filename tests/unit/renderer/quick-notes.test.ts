import { describe, expect, it } from 'vitest';
import type { NoteDtoType } from '../../../src/shared/contracts/hierarchy';
import { QUICK_NOTES_LIMIT, quickNotes } from '../../../src/renderer/palette/quick-notes';

const P = '00000000-0000-4000-8000-0000000000aa';
const note = (i: number, over: Partial<NoteDtoType> = {}): NoteDtoType => ({
  id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
  projectId: null,
  folderId: null,
  title: `Note ${i}`,
  sticky: false,
  color: null,
  pinnedAt: null,
  favorite: false,
  revision: 0,
  locked: false,
  createdAt: i,
  updatedAt: i,
  ...over,
});

describe('palette quick notes (pinned and favorites)', () => {
  it('lists pinned notes by pin time, then favorites that are not pinned by recency, each capped', () => {
    const notes = [
      note(1, { pinnedAt: 10, favorite: true }),
      note(2, { pinnedAt: 30, projectId: P }),
      note(3, { favorite: true, updatedAt: 5 }),
      note(4, { favorite: true, updatedAt: 9 }),
      note(5),
      ...Array.from({ length: QUICK_NOTES_LIMIT + 2 }, (_, i) => note(100 + i, { pinnedAt: i })),
    ];
    const { pinned, favorites } = quickNotes({ projects: [{ id: P, name: 'Work', favorite: false, createdAt: 0, updatedAt: 0 }], folders: [], notes });
    expect(pinned).toHaveLength(QUICK_NOTES_LIMIT);
    expect(pinned.slice(0, 2)).toEqual([
      { id: notes[1]!.id, title: 'Note 2', path: ['Work'] },
      { id: notes[0]!.id, title: 'Note 1', path: ['Common'] },
    ]);
    expect(favorites.map((n) => n.title)).toEqual(['Note 4', 'Note 3']);
  });
});
