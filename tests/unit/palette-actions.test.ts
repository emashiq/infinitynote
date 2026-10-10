import { describe, expect, it } from 'vitest';
import { PALETTE_ACTIONS, filterActions } from '../../src/renderer/state/palette-actions';

describe('palette actions', () => {
  it('has the exact labels and shortcuts', () => {
    expect(PALETTE_ACTIONS.map((a) => [a.label, a.shortcut ?? null])).toEqual([
      ['New note', 'Ctrl+N'],
      ['New plain-text note', null],
      ['New sticky', 'Ctrl+Shift+N'],
      ['New locked note…', null],
      ['New locked sticky…', null],
      ['New project', null],
      ['Import file…', null],
      ['New Word document', null],
      ['New spreadsheet', null],
      ['New presentation', null],
      ['New folder', null],
      ['Go to Home', null],
      ['Open Stickies', null],
      ['Open Reminders', null],
      ['Open Settings', null],
      ['Open graph', null],
      ['Toggle notes tree', 'Ctrl+\\'],
      ['Toggle details panel', 'Ctrl+Shift+\\'],
      ['Close tab', 'Ctrl+W'],
      ['Next tab', 'Ctrl+Tab'],
      ['Previous tab', 'Ctrl+Shift+Tab'],
      ['Find in note', 'Ctrl+F'],
      ['Link to note or document…', null],
      ['Add comment', 'Ctrl+Alt+M'],
      ['Float current note', null],
      ['Export note as Markdown…', null],
      ['Export note as HTML…', null],
      ['Export note as PDF…', null],
      ['Print note…', null],
      ['Lock note…', null],
      ['Lock note now', null],
      ['Lock all notes', null],
      ['Back up now…', null],
      ['Keyboard shortcuts', 'Ctrl+/'],
    ]);
  });

  it('filters by substring or word prefix, keeping list order', () => {
    expect(filterActions(PALETTE_ACTIONS, 'new pro')[0]?.id).toBe('project.new');
    expect(filterActions(PALETTE_ACTIONS, '').length).toBe(PALETTE_ACTIONS.length);
    expect(filterActions(PALETTE_ACTIONS, 'NEW').map((a) => a.id)).toEqual(['note.new', 'note.newPlain', 'sticky.new', 'note.newLocked', 'sticky.newLocked', 'project.new', 'document.newDocx', 'document.newXlsx', 'document.newPptx', 'folder.new']);
    expect(filterActions(PALETTE_ACTIONS, 'powerpoint').map((a) => a.id)).toEqual(['document.import', 'document.newPptx']);
    expect(filterActions(PALETTE_ACTIONS, 'plain').map((a) => a.id)).toEqual(['note.newPlain']);
    expect(filterActions(PALETTE_ACTIONS, 'tog tr').map((a) => a.id)).toEqual(['view.toggleTree']);
    expect(filterActions(PALETTE_ACTIONS, 'float').map((a) => a.id)).toEqual(['note.float']);
    expect(filterActions(PALETTE_ACTIONS, 'link').map((a) => a.id)).toEqual(['note.insertReference']);
    expect(filterActions(PALETTE_ACTIONS, 'zzz')).toEqual([]);
  });
});
