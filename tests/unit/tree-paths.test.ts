import { describe, expect, it } from 'vitest';
import { buildPathIndex, pathOf } from '../../src/shared/tree/paths';

const P = (id: string, name: string, createdAt = 1) => ({ id, name, createdAt });
const F = (id: string, projectId: string | null, parentId: string | null, name: string, createdAt = 1) => ({
  id,
  projectId,
  parentId,
  name,
  createdAt,
});

describe('buildPathIndex', () => {
  it('builds paths for Common and project roots and deep folders', () => {
    const idx = buildPathIndex(
      [P('p1', 'Work')],
      [F('f1', 'p1', null, 'Specs'), F('f2', 'p1', 'f1', '2026'), F('c1', null, null, 'Inbox')],
    );
    expect(idx.get('p1')).toEqual(['Work']);
    expect(idx.get('f2')).toEqual(['Work', 'Specs', '2026']);
    expect(idx.get('c1')).toEqual(['Common', 'Inbox']);
    expect(pathOf(idx, { projectId: null, folderId: null })).toEqual(['Common']);
    expect(pathOf(idx, { projectId: 'p1', folderId: null })).toEqual(['Work']);
    expect(pathOf(idx, { projectId: 'p1', folderId: 'f2' })).toEqual(['Work', 'Specs', '2026']);
  });

  it('adds ordinals to duplicate sibling folders by createdAt', () => {
    const idx = buildPathIndex(
      [P('p1', 'Work')],
      [F('b', 'p1', null, 'specs', 20), F('a', 'p1', null, 'Specs', 10), F('c', 'p1', null, 'SPECS', 30)],
    );
    expect(idx.get('a')).toEqual(['Work', 'Specs']);
    expect(idx.get('b')).toEqual(['Work', 'specs (2)']);
    expect(idx.get('c')).toEqual(['Work', 'SPECS (3)']);
  });

  it('does not suffix equal names in different parents or different scopes', () => {
    const idx = buildPathIndex(
      [P('p1', 'A'), P('p2', 'B')],
      [F('x', 'p1', null, 'Notes'), F('y', 'p2', null, 'Notes'), F('z', null, null, 'Notes'), F('w', 'p1', 'x', 'Notes')],
    );
    expect(idx.get('x')).toEqual(['A', 'Notes']);
    expect(idx.get('y')).toEqual(['B', 'Notes']);
    expect(idx.get('z')).toEqual(['Common', 'Notes']);
    expect(idx.get('w')).toEqual(['A', 'Notes', 'Notes']);
  });

  it('disambiguates projects with equal names', () => {
    const idx = buildPathIndex([P('p2', 'Work', 2), P('p1', 'Work', 1)], [F('f', 'p2', null, 'Specs')]);
    expect(idx.get('p1')).toEqual(['Work']);
    expect(idx.get('p2')).toEqual(['Work (2)']);
    expect(idx.get('f')).toEqual(['Work (2)', 'Specs']);
  });

  it('survives a missing parent and falls back to Common for unknown locations', () => {
    const idx = buildPathIndex([], [F('f', null, 'ghost', 'Orphan')]);
    expect(idx.get('f')).toEqual(['Common', 'Orphan']);
    expect(pathOf(idx, { projectId: 'nope', folderId: 'nope' })).toEqual(['Common']);
  });
});
