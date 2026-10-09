// @vitest-environment jsdom
import type { Editor, JSONContent } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { beforeAll, describe, expect, it } from 'vitest';
import { tableClipboardText } from '../../../../src/renderer/editor/table-clipboard';
import { insertTable, tableHasHeaderRow, tableMenuItems } from '../../../../src/renderer/editor/table-actions';
import { normalizeRichDoc } from '../../../../src/shared/editor/doc-schema';
import { TABLE_PASTED_AS_TEXT_MESSAGE, TABLE_TOO_LARGE_MESSAGE } from '../../../../src/shared/editor/table-limits';
import { toSavable } from '../../../../src/shared/editor/savable';
import { blockIds, makeEditor, pasteEvent, pasteHtml, tick, UUID_V4 } from './support';

/** Each table as rows of cell texts. */
function tables(editor: Editor): string[][][] {
  const out: string[][][] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'table') return true;
    const rows: string[][] = [];
    node.forEach((row) => {
      const cells: string[] = [];
      row.forEach((cell) => cells.push(cell.textContent));
      rows.push(cells);
    });
    out.push(rows);
    return false;
  });
  return out;
}

const cellTypes = (editor: Editor) => {
  const types: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') types.push(node.type.name);
  });
  return types;
};

/** The position of the text node `text` (its cell starts two positions before it). */
function cellPos(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text === text) found = pos;
    return true;
  });
  if (found < 0) throw new Error(`no cell ${text}`);
  return found;
}

/** A key press through the editor's key handlers (Tiptap's keyboardShortcut command keeps only document steps). */
function press(editor: Editor, key: string, shiftKey = false): void {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  editor.view.someProp('handleKeyDown', (f) => f(editor.view, event));
}

async function reloads(editor: Editor) {
  const json = toSavable(editor.getJSON());
  const normalized = normalizeRichDoc(json);
  const again = makeEditor({ content: normalized as JSONContent });
  await tick();
  return { normalized, again: again.editor };
}

// jsdom has no layout: when a deferred focus scrolls the cursor into view, ProseMirror measures a text range.
beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
});

describe('tables in rich notes', () => {
  it('Insert table makes rows x columns with a header row, the cursor in the first cell; the document saves and reloads', async () => {
    const { editor } = makeEditor({ content: '<p>before</p>' });
    await tick();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    insertTable(editor, { rows: 3, cols: 2, withHeaderRow: true });
    expect(tables(editor)).toEqual([
      [
        ['', ''],
        ['', ''],
        ['', ''],
      ],
    ]);
    expect(cellTypes(editor)).toEqual(['tableHeader', 'tableHeader', 'tableCell', 'tableCell', 'tableCell', 'tableCell']);
    expect(tableHasHeaderRow(editor.state)).toBe(true);
    editor.commands.insertContent('Name');
    expect(tables(editor)[0]![0]).toEqual(['Name', '']);

    const { normalized, again } = await reloads(editor);
    expect(JSON.stringify(normalized)).toContain('"type":"tableHeader"');
    expect(tables(again)).toEqual(tables(editor));
  });

  it('the table gets a block ID, rows and cells none, the paragraphs in cells their own', async () => {
    const { editor } = makeEditor({ content: '<p>x</p>' });
    await tick();
    insertTable(editor, { rows: 2, cols: 2, withHeaderRow: false });
    await tick();
    const ids = blockIds(editor);
    const table = ids.find((b) => b.type === 'table');
    expect(table?.id).toMatch(UUID_V4);
    expect(ids.filter((b) => b.type === 'paragraph' && b.id !== null).length).toBeGreaterThanOrEqual(4);
    let rowOrCellWithId = false;
    editor.state.doc.descendants((node) => {
      if (['tableRow', 'tableCell', 'tableHeader'].includes(node.type.name) && 'id' in node.attrs) rowOrCellWithId = true;
    });
    expect(rowOrCellWithId).toBe(false);
  });

  it('Tab moves to the next cell and adds a row after the last one; Shift+Tab moves back', async () => {
    const { editor } = makeEditor({ content: '<p></p>' });
    await tick();
    insertTable(editor, { rows: 1, cols: 2, withHeaderRow: false });
    editor.commands.insertContent('a');
    press(editor, 'Tab');
    editor.commands.insertContent('b');
    press(editor, 'Tab');
    editor.commands.insertContent('c');
    expect(tables(editor)).toEqual([
      [
        ['a', 'b'],
        ['c', ''],
      ],
    ]);
    // Shift+Tab selects the previous cell's text, as Tab does with the next one.
    press(editor, 'Tab', true);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe('b');
  });

  it('the Table menu adds and deletes rows and columns, toggles the header row and deletes the table', async () => {
    const { editor } = makeEditor({ content: '<p></p>' });
    await tick();
    insertTable(editor, { rows: 2, cols: 2, withHeaderRow: true });
    const choose = (label: string) => tableMenuItems(editor, tableHasHeaderRow(editor.state)).find((i) => i.label === label)!.onSelect();
    expect(tableMenuItems(editor, true).map((i) => i.label)).toEqual([
      'Add row above',
      'Add row below',
      'Add column left',
      'Add column right',
      'Delete row',
      'Delete column',
      'Remove header row',
      'Delete table',
    ]);
    choose('Remove header row');
    expect(tableHasHeaderRow(editor.state)).toBe(false);
    expect(cellTypes(editor).every((t) => t === 'tableCell')).toBe(true);
    choose('Add header row');
    expect(tableHasHeaderRow(editor.state)).toBe(true);
    choose('Add row below');
    choose('Add column right');
    expect(tables(editor)[0]).toHaveLength(3);
    expect(tables(editor)[0]![0]).toHaveLength(3);
    choose('Add row above');
    choose('Add column left');
    expect(tables(editor)[0]).toHaveLength(4);
    expect(tables(editor)[0]![0]).toHaveLength(4);
    choose('Delete column');
    choose('Delete row');
    expect(tables(editor)[0]).toHaveLength(3);
    expect(tables(editor)[0]![0]).toHaveLength(3);
    choose('Delete table');
    expect(tables(editor)).toEqual([]);
  });

  it('a resized column keeps its width through save and reload', async () => {
    const { editor } = makeEditor({ content: '<p></p>' });
    await tick();
    insertTable(editor, { rows: 1, cols: 2, withHeaderRow: false });
    editor.commands.setCellAttribute('colwidth', [180]);
    const { normalized, again } = await reloads(editor);
    expect(JSON.stringify(normalized)).toContain('"colwidth":[180]');
    let width: unknown = null;
    again.state.doc.descendants((node) => {
      if (node.type.name === 'tableCell' && width === null) width = node.attrs.colwidth;
    });
    expect(width).toEqual([180]);
  });
});

describe('table clipboard', () => {
  it('pasting a spreadsheet HTML table (Excel-like, with styles and classes) creates a sanitized table', async () => {
    const { editor } = makeEditor({ content: '<p></p>' });
    await tick();
    const html =
      '<html><head><style>.xl65{color:red}</style></head><body><table><colgroup><col width="120"><col width="80"></colgroup>' +
      '<tr><td class="xl65" style="color:#ff0000;background:url(https://evil.example/x.png)" onclick="x()">Item</td><td>Qty</td></tr>' +
      '<tr><td>Apples</td><td align="right">3</td></tr></table></body></html>';
    pasteEvent(editor, { html, text: 'Item\tQty\nApples\t3\n' });
    expect(tables(editor)).toEqual([
      [
        ['Item', 'Qty'],
        ['Apples', '3'],
      ],
    ]);
    const json = JSON.stringify(editor.getJSON());
    expect(json).not.toContain('evil.example');
    expect(json).not.toContain('onclick');
    expect(json).toContain('"colwidth":[120]');
    expect(json).toContain('"align":"right"');
    expect(normalizeRichDoc(toSavable(editor.getJSON()))).toBeTruthy();
  });

  it('a pasted web table with a header row keeps its header cells', async () => {
    const { editor } = makeEditor({ content: '<p></p>' });
    await tick();
    pasteEvent(editor, { html: '<table><thead><tr><th>City</th><th>Pop</th></tr></thead><tbody><tr><td>Oslo</td><td>700k</td></tr></tbody></table>', text: 'City Pop' });
    expect(tables(editor)[0]).toEqual([
      ['City', 'Pop'],
      ['Oslo', '700k'],
    ]);
    expect(cellTypes(editor).slice(0, 2)).toEqual(['tableHeader', 'tableHeader']);
  });

  it('tab-separated text with several rows and columns becomes a table; quoted cells keep tabs and line breaks', async () => {
    const { editor } = makeEditor({ content: '<p></p>' });
    await tick();
    pasteEvent(editor, { text: 'Name\tNote\r\nAda\t"first\tline\nsecond"\r\nBob\t""quoted""\r\n' });
    expect(tables(editor)).toEqual([
      [
        ['Name', 'Note'],
        ['Ada', 'first\tline\nsecond'],
        ['Bob', '""quoted""'],
      ],
    ]);
  });

  it('text that is not a table stays text: one column, ragged rows, tab-indented lines, inside a code block', async () => {
    for (const text of ['one\ttwo', 'a\tb\nc', '\tindented\n\tlines', 'plain\nlines']) {
      const { editor } = makeEditor({ content: '<p></p>' });
      await tick();
      pasteEvent(editor, { text });
      expect(tables(editor), JSON.stringify(text)).toEqual([]);
    }
    const { editor } = makeEditor({ content: '<pre><code>x</code></pre>' });
    await tick();
    editor.commands.setTextSelection(2);
    pasteEvent(editor, { text: 'a\tb\nc\td' });
    expect(tables(editor)).toEqual([]);
    expect(editor.getText()).toContain('a\tb\nc\td');
  });

  it('a plain-text note never makes a table', async () => {
    const { editor } = makeEditor({ format: 'plain', content: '<p></p>' });
    await tick();
    pasteEvent(editor, { text: 'a\tb\nc\td' });
    expect(editor.state.schema.nodes.table).toBeUndefined();
    expect(editor.getText({ blockSeparator: '\n' })).toBe('a\tb\nc\td');
  });

  it('copying a table or some of its cells puts tab-separated text next to the HTML', async () => {
    const { editor } = makeEditor({ content: '<p></p>' });
    await tick();
    pasteHtml(editor, '<p>Intro</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>two words</td></tr></table><p>After</p>');
    editor.commands.selectAll();
    expect(tableClipboardText(editor.state.selection.content(), editor.schema)).toBe('Intro\n\nA\tB\n1\ttwo words\n\nAfter');

    const cells = CellSelection.create(editor.state.doc, cellPos(editor, 'B') - 2, cellPos(editor, 'two words') - 2);
    editor.view.dispatch(editor.state.tr.setSelection(cells));
    expect(tableClipboardText(editor.state.selection.content(), editor.schema)).toBe('B\ntwo words');

    editor.commands.setTextSelection({ from: 2, to: 4 });
    expect(tableClipboardText(editor.state.selection.content(), editor.schema)).toBeNull();
  });
});

describe('table size limits in the editor (D-116)', () => {
  /** The acceptor's case as HTML: one row of 100 cells spanning 1,000 columns, then 1,000 one-cell rows. */
  const hugeTableHtml = `<table><tr>${'<td colspan="1000">x</td>'.repeat(100)}</tr>${'<tr><td>y</td></tr>'.repeat(1000)}</table>`;

  it('a pasted table over the limits is refused with a message, outside a table and inside a cell, before any cell is laid out', async () => {
    const { editor, notices } = makeEditor({ content: '<p>keep</p>' });
    await tick();
    editor.commands.setTextSelection(2);
    const started = performance.now();
    pasteEvent(editor, { html: hugeTableHtml, text: 'x' });
    expect(notices).toEqual([TABLE_TOO_LARGE_MESSAGE]);
    expect(tables(editor)).toEqual([]);
    expect(editor.getText()).toBe('keep');

    insertTable(editor, { rows: 2, cols: 2, withHeaderRow: false });
    const before = editor.state.doc;
    // The table plugin's own paste handler would expand the pasted cells into the selected table.
    pasteEvent(editor, { html: hugeTableHtml, text: 'x' });
    expect(notices).toEqual([TABLE_TOO_LARGE_MESSAGE, TABLE_TOO_LARGE_MESSAGE]);
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('tab-separated text over 10,000 cells is pasted as text with a message', async () => {
    const { editor, notices } = makeEditor({ content: '<p></p>' });
    await tick();
    const text = Array.from({ length: 5001 }, (_, i) => `a${i}\tb${i}`).join('\n');
    pasteEvent(editor, { text });
    expect(notices).toEqual([TABLE_PASTED_AS_TEXT_MESSAGE]);
    expect(tables(editor)).toEqual([]);
    expect(editor.getText()).toContain('a5000\tb5000');
  });

  it('an edit that would grow a table past the limits is refused: a row or column added to a full 100 x 100 grid, 51 columns merged', async () => {
    // 100 rows of two cells spanning 50 columns each: a 100 x 100 grid in 200 cells (jsdom is slow with 10,000 cells).
    const wide = { type: 'tableCell', attrs: { colspan: 50 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'w' }] }] };
    const content = { type: 'doc', content: [{ type: 'table', content: Array.from({ length: 100 }, () => ({ type: 'tableRow', content: [wide, wide] })) }] };
    const { editor, notices } = makeEditor({ content: content as JSONContent });
    await tick();
    editor.commands.setTextSelection(cellPos(editor, 'w'));
    const choose = (label: string) => tableMenuItems(editor, false).find((i) => i.label === label)!.onSelect();
    choose('Add row below');
    expect(tables(editor)[0]).toHaveLength(100);
    choose('Add column right');
    expect(editor.state.doc.firstChild!.firstChild!.childCount).toBe(2);
    expect(notices).toEqual([TABLE_TOO_LARGE_MESSAGE, TABLE_TOO_LARGE_MESSAGE]);
    choose('Delete row');
    expect(tables(editor)[0]).toHaveLength(99);
    choose('Add row below');
    expect(tables(editor)[0]).toHaveLength(100);
    expect(notices).toHaveLength(2);

    const { editor: small, notices: smallNotices } = makeEditor({ content: '<p></p>' });
    await tick();
    insertTable(small, { rows: 1, cols: 51, withHeaderRow: false });
    const first = cellPosOfIndex(small, 0);
    const last = cellPosOfIndex(small, 50);
    small.view.dispatch(small.state.tr.setSelection(CellSelection.create(small.state.doc, first, last)));
    small.commands.mergeCells();
    expect(smallNotices).toEqual([TABLE_TOO_LARGE_MESSAGE]);
    expect(tables(small)[0]![0]).toHaveLength(51);
  });
});

/** The position of the n-th cell of the first table. */
function cellPosOfIndex(editor: Editor, n: number): number {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.spec.tableRole === 'cell') positions.push(pos);
    return true;
  });
  return positions[n]!;
}
