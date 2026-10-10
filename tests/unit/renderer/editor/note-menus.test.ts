// @vitest-environment jsdom
import type { JSONContent } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it, vi } from 'vitest';
import { insertItems, noteMenuItems, type NoteActions } from '../../../../src/renderer/editor/note-actions';
import { bubbleKind, placeFloating } from '../../../../src/renderer/editor/placement';
import { slashMatch } from '../../../../src/renderer/editor/slash-menu';
import { filterActions } from '../../../../src/renderer/state/palette-actions';
import { makeEditor } from './support';

const p = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });

/** A rich editor with the cursor right after the text of its single paragraph. */
function typed(text: string, extra: JSONContent | null = null) {
  const { editor } = makeEditor({ content: { type: 'doc', content: [extra ?? p(text)] } });
  editor.commands.setTextSelection(1 + text.length);
  return editor;
}

describe('insert menu trigger (D-102)', () => {
  it('opens for "/" at the start of a line or after a space, with the letters typed after it', () => {
    expect(slashMatch(typed('/').state)).toEqual({ from: 1, to: 2, query: '' });
    expect(slashMatch(typed('/link').state)).toEqual({ from: 1, to: 6, query: 'link' });
    expect(slashMatch(typed('Pay rent tomorrow /rem').state)).toEqual({ from: 19, to: 23, query: 'rem' });
    expect(slashMatch(typed('আমি /ছবি').state)?.query).toBe('ছবি');
  });

  it('stays plain text inside words, after a space in the command, in code blocks and with a selection', () => {
    expect(slashMatch(typed('and/or').state)).toBeNull();
    expect(slashMatch(typed('10/9').state)).toBeNull();
    expect(slashMatch(typed('/link to').state)).toBeNull();
    expect(slashMatch(typed('/abcdefghijklmnopqrstu').state)).toBeNull();
    expect(slashMatch(typed('/code', { type: 'codeBlock', content: [{ type: 'text', text: '/code' }] }).state)).toBeNull();
    const editor = typed('/link');
    editor.commands.setTextSelection({ from: 2, to: 6 });
    expect(slashMatch(editor.state)).toBeNull();
  });

  it('looks only at the text right before the cursor of a long paragraph', () => {
    const long = `${'word '.repeat(5000)}/h`;
    expect(slashMatch(typed(long).state)).toEqual({ from: 1 + long.length - 2, to: 1 + long.length, query: 'h' });
  });
});

describe('floating toolbar (D-102)', () => {
  it('formats a selection or on request, sizes a selected image and shows links; nothing in read-only text', () => {
    const editor = typed('see docs');
    const at = (opts: { editable: boolean; requested: boolean }) => bubbleKind(editor.state, opts);
    expect(at({ editable: true, requested: false })).toBeNull();
    expect(at({ editable: true, requested: true })).toBe('format');
    editor.commands.setTextSelection({ from: 5, to: 9 });
    expect(at({ editable: true, requested: false })).toBe('format');
    expect(at({ editable: false, requested: false })).toBeNull();
    editor.commands.setLink({ href: 'https://example.com/docs' });
    editor.commands.setTextSelection(7);
    expect(at({ editable: true, requested: false })).toBe('link');
    expect(at({ editable: false, requested: true })).toBe('link');
  });

  it('shows the size presets for a selected image only while the note is editable', () => {
    const { editor } = makeEditor({
      content: { type: 'doc', content: [p('a'), { type: 'image', attrs: { attachmentId: crypto.randomUUID(), width: 4, height: 3, alt: null } }] },
    });
    const pos = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    expect(bubbleKind(editor.state, { editable: true, requested: false })).toBe('image');
    expect(bubbleKind(editor.state, { editable: false, requested: false })).toBeNull();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    expect(bubbleKind(editor.state, { editable: true, requested: false })).toBeNull();
  });

  it('floats above the target, flips below when only there is room and stays inside the surface', () => {
    const surface = { left: 100, top: 50, right: 700, bottom: 2000 };
    const viewport = { left: 100, top: 50, right: 700, bottom: 650 };
    const size = { width: 200, height: 36 };
    const target = { left: 300, top: 300, right: 400, bottom: 320 };
    expect(placeFloating({ target, size, surface, viewport, side: 'above', align: 'center' })).toEqual({ left: 150, top: 206 });
    // The first visible line: no room above, so below.
    const top = { ...target, top: 60, bottom: 80 };
    expect(placeFloating({ target: top, size, surface, viewport, side: 'above', align: 'center' })).toEqual({ left: 150, top: 38 });
    // The last visible line: the insert menu opens above instead of below.
    const bottom = { left: 650, top: 620, right: 652, bottom: 640 };
    expect(placeFloating({ target: bottom, size, surface, viewport, side: 'below', align: 'start' })).toEqual({ left: 400, top: 526 });
    expect(placeFloating({ target: { ...target, left: 90, right: 95 }, size, surface, viewport, side: 'below', align: 'center' }).left).toBe(0);
  });
});

function actions(overrides: Partial<NoteActions> = {}): NoteActions {
  return {
    insertAttachment: vi.fn(),
    openFind: vi.fn(),
    convert: vi.fn(),
    openVersions: vi.fn(),
    ...overrides,
  };
}

describe('note menus (D-102)', () => {
  it('the context menu of a tab offers insert, reminders and the note actions in groups', () => {
    const items = noteMenuItems(actions({ insertTable: vi.fn(), insertReference: vi.fn(), addReminder: vi.fn(), createFromText: vi.fn(), float: vi.fn() }), { format: 'rich', editable: true });
    expect(items.map((i) => [i.label, !!i.separatorBefore])).toEqual([
      ['Insert image', false],
      ['Attach file', false],
      ['Insert table…', false],
      ['Link to note or document…', false],
      ['Add reminder…', true],
      ['Create reminder from text', false],
      ['Find in note', true],
      ['Convert to plain text…', false],
      ['Version history…', false],
      ['Float as sticky', false],
    ]);
    expect(items.every((i) => !i.disabled)).toBe(true);
  });

  it('plain and read-only notes keep find and history; edits are disabled', () => {
    const a = actions({ createFromText: vi.fn() });
    const plain = noteMenuItems(a, { format: 'plain', editable: true });
    expect(plain.map((i) => i.label)).toEqual(['Create reminder from text', 'Find in note', 'Convert to rich text', 'Version history…']);
    plain.find((i) => i.label === 'Convert to rich text')!.onSelect();
    expect(a.convert).toHaveBeenCalledWith('rich');
    const readOnly = noteMenuItems(actions(), { format: 'rich', editable: false });
    expect(readOnly.filter((i) => i.disabled).map((i) => i.label)).toEqual(['Insert image', 'Attach file', 'Convert to plain text…']);
  });

  it('offers "Lock note…", or "Lock now" and "Lock settings…" for a locked note (D-111)', () => {
    const lock = { locked: false, open: vi.fn(), lockNow: vi.fn() };
    const open = noteMenuItems(actions({ lock }), { format: 'rich', editable: true });
    expect(open.slice(-1).map((i) => i.label)).toEqual(['Lock note…']);
    open.at(-1)!.onSelect();
    expect(lock.open).toHaveBeenCalledTimes(1);
    const locked = noteMenuItems(actions({ lock: { ...lock, locked: true } }), { format: 'plain', editable: true });
    expect(locked.slice(-2).map((i) => i.label)).toEqual(['Lock now', 'Lock settings…']);
    locked.at(-2)!.onSelect();
    expect(lock.lockNow).toHaveBeenCalledTimes(1);
    expect(noteMenuItems(actions(), { format: 'rich', editable: true }).some((i) => i.label.startsWith('Lock'))).toBe(false);
  });

  it('in a table the context menu starts with the table actions', () => {
    const table = [
      { id: 'rowAfter', label: 'Add row below', onSelect: vi.fn() },
      { id: 'deleteTable', label: 'Delete table', separatorBefore: true, onSelect: vi.fn() },
    ];
    const items = noteMenuItems(actions({ insertTable: vi.fn() }), { format: 'rich', editable: true, table });
    expect(items.slice(0, 4).map((i) => [i.label, !!i.separatorBefore])).toEqual([
      ['Add row below', false],
      ['Delete table', true],
      ['Insert image', true],
      ['Attach file', false],
    ]);
  });

  it('the insert menu lists block types, attachments, note links and reminders, filtered by what is typed', () => {
    const editor = typed('');
    const a = actions({ insertTable: vi.fn(), insertReference: vi.fn(), addReminder: vi.fn(), createFromText: vi.fn() });
    const items = insertItems(editor, a);
    expect(items.map((i) => i.label)).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bulleted list',
      'Numbered list',
      'Checklist',
      'Code block',
      'Diagram',
      'Math block',
      'Inline math',
      'Table',
      'Insert image',
      'Attach file',
      'Link to note or document…',
      'Add reminder…',
      'Create reminder from text',
    ]);
    expect(filterActions(items, 'link').map((i) => i.id)).toEqual(['reference']);
    expect(filterActions(items, 'rem').map((i) => i.id)).toEqual(['reminder', 'fromText']);
    expect(filterActions(items, 'todo').map((i) => i.id)).toEqual(['checklist']);
    expect(filterActions(items, 'mermaid').map((i) => i.id)).toEqual(['diagram']);
    expect(filterActions(items, 'latex').map((i) => i.id)).toEqual(['mathBlock', 'mathInline']);
    expect(filterActions(items, 'table').map((i) => i.id)).toEqual(['table']);
    items.find((i) => i.id === 'table')!.run();
    expect(a.insertTable).toHaveBeenCalled();
    expect(filterActions(items, 'h2').map((i) => i.id)).toEqual(['h2']);
    items.find((i) => i.id === 'checklist')!.run();
    expect(editor.isActive('taskList')).toBe(true);
    items.find((i) => i.id === 'image')!.run();
    expect(a.insertAttachment).toHaveBeenCalledWith('image');
    expect(insertItems(editor, actions()).map((i) => i.id)).not.toContain('reference');
  });
});
