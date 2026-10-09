import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { isInTable, rowIsHeader, selectedRect } from '@tiptap/pm/tables';
import type { MenuItem } from '../ui/Menu';

/** What "Insert table" starts with, and the largest table it creates. */
export const DEFAULT_TABLE = { rows: 3, cols: 3, withHeaderRow: true } as const;
export const MAX_TABLE = { rows: 100, cols: 20 } as const;

export interface TableSize {
  rows: number;
  cols: number;
  withHeaderRow: boolean;
}

/** Whether the first row of the table at the selection is a header row. */
export function tableHasHeaderRow(state: EditorState): boolean {
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  return rowIsHeader(rect.map, rect.table, 0);
}

/**
 * Inserts a table at the cursor with the cursor in its first cell. The focus moves at once (Tiptap's focus command waits
 * for a frame), so keys typed right after the dialog closes reach the table.
 */
export function insertTable(editor: Editor, size: TableSize): void {
  editor.chain().insertTable(size).run();
  editor.view.focus();
}

/** The "Table" menu of the formatting toolbar and the note menu, for the table at the cursor. */
export function tableMenuItems(editor: Editor, headerRow: boolean): MenuItem[] {
  const run = (command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => void command(editor.chain().focus()).run();
  return [
    { id: 'rowBefore', label: 'Add row above', onSelect: run((c) => c.addRowBefore()) },
    { id: 'rowAfter', label: 'Add row below', onSelect: run((c) => c.addRowAfter()) },
    { id: 'colBefore', label: 'Add column left', onSelect: run((c) => c.addColumnBefore()) },
    { id: 'colAfter', label: 'Add column right', onSelect: run((c) => c.addColumnAfter()) },
    { id: 'deleteRow', label: 'Delete row', separatorBefore: true, onSelect: run((c) => c.deleteRow()) },
    { id: 'deleteCol', label: 'Delete column', onSelect: run((c) => c.deleteColumn()) },
    { id: 'header', label: headerRow ? 'Remove header row' : 'Add header row', separatorBefore: true, onSelect: run((c) => c.toggleHeaderRow()) },
    { id: 'deleteTable', label: 'Delete table', separatorBefore: true, onSelect: run((c) => c.deleteTable()) },
  ];
}
