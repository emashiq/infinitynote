import type { z } from 'zod';
import { WORKBOOK_MESSAGES } from '../../../shared/documents/workbook-messages';

/**
 * Which FortuneSheet tools the editor offers (D-140): only what the workbook model keeps, so nothing made in the grid
 * is lost on save. Conditional formats, data validation, links, images, charts and screenshots are left out, and so is
 * the context menu's Paste, which would need clipboard read access (Ctrl+V pastes from the system clipboard). A CSV
 * keeps values only: undo and redo, and editing rows, columns and cells.
 */
const XLSX_TOOLBAR = [
  'undo', 'redo', 'format-painter', 'clear-format', '|',
  'currency-format', 'percentage-format', 'number-decrease', 'number-increase', 'format', '|',
  'font', '|', 'font-size', '|',
  'bold', 'italic', 'strike-through', 'underline', '|',
  'font-color', 'background', 'border', 'merge-cell', '|',
  'horizontal-align', 'vertical-align', 'text-wrap', 'text-rotation', '|',
  'freeze', 'filter', 'comment', 'quick-formula',
];
const CSV_TOOLBAR = ['undo', 'redo'];

const ROWS_AND_COLUMNS = ['insert-row', 'insert-column', 'delete-row', 'delete-column'];
const SIZES = ['hide-row', 'hide-column', 'set-row-height', 'set-column-width'];
const SORTING = ['sort', 'orderAZ', 'orderZA'];

export interface GridMenus {
  toolbarItems: string[];
  cellContextMenu: string[];
  headerContextMenu: string[];
  sheetTabContextMenu: string[];
}

export function gridMenus(csv: boolean): GridMenus {
  if (csv) {
    return {
      toolbarItems: CSV_TOOLBAR,
      cellContextMenu: ['copy', '|', ...ROWS_AND_COLUMNS, 'delete-cell', '|', 'clear', ...SORTING],
      headerContextMenu: ['copy', '|', ...ROWS_AND_COLUMNS, '|', 'clear', ...SORTING],
      sheetTabContextMenu: [],
    };
  }
  return {
    toolbarItems: XLSX_TOOLBAR,
    cellContextMenu: ['copy', '|', ...ROWS_AND_COLUMNS, 'delete-cell', ...SIZES, '|', 'clear', ...SORTING, 'filter', 'cell-format'],
    headerContextMenu: ['copy', '|', ...ROWS_AND_COLUMNS, ...SIZES, '|', 'clear', ...SORTING],
    sheetTabContextMenu: ['delete', 'copy', 'rename', 'color', 'hide', '|', 'move'],
  };
}

/** What to tell the user when the edited workbook does not fit the model (a sheet name, the size limits). */
export function modelProblem(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path ?? [];
  if (path.includes('name')) return WORKBOOK_MESSAGES.invalidSheetName;
  if (issue?.message === 'Too many cells') return WORKBOOK_MESSAGES.tooManyCells;
  if (issue?.message === 'Sheet too large' || path.includes('rowCount') || path.includes('colCount')) return WORKBOOK_MESSAGES.sheetTooLarge;
  if (path.includes('cells') && issue?.code === 'too_big') return WORKBOOK_MESSAGES.textTooLong;
  return WORKBOOK_MESSAGES.writeFailed;
}
