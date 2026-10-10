// @vitest-environment jsdom
import type { Sheet as GridSheet } from '@fortune-sheet/core';
import { describe, expect, it } from 'vitest';
import { cellBorders, fromGridSheets, GRID_DEFAULT_FONT, GRID_FONTS, heightToPx, pxToHeight, pxToWidth, toGridSheets, widthToPx } from '../../../src/renderer/documents/spreadsheet/fortune-model';
import { findInSheets, stepMatch } from '../../../src/renderer/documents/spreadsheet/sheet-find';
import { gridMenus, modelProblem } from '../../../src/renderer/documents/spreadsheet/spreadsheet-config';
import { Workbook, WORKBOOK_LIMITS, type SheetType, type WorkbookType } from '../../../src/shared/documents/workbook';
import { WORKBOOK_MESSAGES } from '../../../src/shared/documents/workbook-messages';

function sheet(name: string, fields: Partial<SheetType> = {}): SheetType {
  return {
    name,
    hidden: false,
    tabColor: null,
    rowCount: 6,
    colCount: 4,
    cells: [],
    merges: [],
    colWidths: [],
    rowHeights: [],
    hiddenRows: [],
    hiddenCols: [],
    frozen: { rows: 0, cols: 0 },
    filter: null,
    ...fields,
  };
}

const workbook: WorkbookType = {
  activeSheet: 1,
  styles: [
    { font: 'Arial', size: 14, bold: true, italic: true, underline: true, strike: true, color: '#c00000', fill: '#ffff00', hAlign: 'center', vAlign: 'top', wrap: true, top: { style: 'thin', color: '#0000ff' }, bottom: { style: 'double', color: '#000000' } },
    { numFmt: '0.00', hAlign: 'right' },
    { numFmt: 'yyyy-mm-dd', rotation: 45, vAlign: 'middle' },
    { left: { style: 'thick', color: '#00ff00' } },
  ],
  sheets: [
    sheet('Budget', {
      tabColor: '#00b050',
      cells: [
        { r: 0, c: 0, v: 'Item', s: 0, note: 'Header note' },
        { r: 0, c: 1, v: 12.5, s: 1 },
        { r: 0, c: 2, v: true },
        { r: 1, c: 1, v: 7 },
        { r: 1, c: 2, v: 46305, s: 2 },
        { r: 2, c: 1, f: 'SUM(B1:B2)', v: 19.5 },
        { r: 3, c: 0, v: 'Merged' },
        { r: 4, c: 3, s: 3 },
        { r: 5, c: 0, f: '1/0', v: '#DIV/0!' },
      ],
      merges: [{ r: 3, c: 0, rows: 2, cols: 2 }],
      colWidths: [{ i: 0, size: 20 }],
      rowHeights: [{ i: 1, size: 30 }],
      hiddenRows: [5],
      hiddenCols: [2],
      frozen: { rows: 2, cols: 1 },
      filter: { r: 0, c: 0, rows: 3, cols: 4 },
    }),
    sheet('Second', { rowCount: 1, colCount: 1, cells: [{ r: 0, c: 0, v: 'two' }], frozen: { rows: 1, cols: 0 } }),
    sheet('Hidden', { rowCount: 1, colCount: 3, hidden: true, frozen: { rows: 0, cols: 3 } }),
  ],
};

describe('the workbook model in FortuneSheet (D-140)', () => {
  it('converts to the grid and back to the same model', () => {
    const grid = toGridSheets(workbook, WORKBOOK_LIMITS.maxGridCells);
    const back = fromGridSheets(grid);
    expect(Workbook.safeParse(back).success).toBe(true);
    expect(back).toEqual(workbook);
  });

  it('gives the grid what FortuneSheet expects: formulas with =, display text, merges, sizes in pixels, panes, filter and the active sheet', () => {
    const [budget, second, hidden] = toGridSheets(workbook, WORKBOOK_LIMITS.maxGridCells);
    const at = (r: number, c: number) => budget!.celldata!.find((d) => d.r === r && d.c === c)?.v;
    expect(at(2, 1)).toMatchObject({ f: '=SUM(B1:B2)', v: 19.5 });
    expect(at(0, 1)).toMatchObject({ v: 12.5, m: '12.50', ct: { fa: '0.00', t: 'n' } });
    expect(at(1, 2)).toMatchObject({ m: '2026-10-10', ct: { t: 'd' } });
    expect(at(0, 2)).toMatchObject({ v: true, m: 'TRUE', ct: { t: 'b' } });
    expect(at(5, 0)).toMatchObject({ ct: { t: 'e' } });
    expect(at(0, 0)).toMatchObject({ ff: 'Arial', fs: 14, bl: 1, it: 1, un: 1, cl: 1, fc: '#c00000', bg: '#ffff00', ht: 0, vt: 1, tb: '2', ps: { value: 'Header note' } });
    // Excel's default alignment is the bottom.
    expect(at(1, 1)).toMatchObject({ vt: 2 });
    expect(at(3, 0)).toMatchObject({ v: 'Merged', mc: { r: 3, c: 0, rs: 2, cs: 2 } });
    expect(at(4, 1)).toEqual({ mc: { r: 3, c: 0 } });
    expect(budget!.config!.merge).toEqual({ '3_0': { r: 3, c: 0, rs: 2, cs: 2 } });
    expect(budget!.config!.columnlen).toEqual({ '0': 145 });
    expect(budget!.config!.rowlen).toEqual({ '1': 40 });
    expect(budget!.config!.rowhidden).toEqual({ '5': 0 });
    expect(budget!.frozen).toEqual({ type: 'rangeBoth', range: { row_focus: 1, column_focus: 0 } });
    expect(second!.frozen).toEqual({ type: 'rangeRow', range: { row_focus: 0, column_focus: 0 } });
    expect(hidden!.frozen).toEqual({ type: 'rangeColumn', range: { row_focus: 0, column_focus: 2 } });
    expect(hidden!.hide).toBe(1);
    expect(budget!.filter_select).toEqual({ row: [0, 2], column: [0, 3] });
    expect(budget!.calcChain).toEqual([
      { r: 2, c: 1, id: 'sheet-1' },
      { r: 5, c: 0, id: 'sheet-1' },
    ]);
    expect([budget!.status, second!.status]).toEqual([0, 1]);
    // Room to type past the content.
    expect(budget!.row).toBeGreaterThanOrEqual(100);
    expect(budget!.column).toBeGreaterThanOrEqual(26);
  });

  it('keeps the grid within the limit when the content is large', () => {
    const big = { ...workbook, sheets: [sheet('Big', { rowCount: 19_000, colCount: 100 })], activeSheet: 0 };
    const [grid] = toGridSheets(big, 2_000_000);
    expect(grid!.row! * grid!.column!).toBeLessThanOrEqual(2_000_000);
    expect(grid!.row).toBeGreaterThanOrEqual(19_000);
  });

  it('reads edits made in the grid: typed values, numeric fonts, inline text, preset rotations, tab order and new sheets', () => {
    const grid: GridSheet[] = [
      { name: 'Later', order: 1, status: 1, data: [[{ v: 'b', ff: 1, tr: '4' }, { v: 3, m: '3', ct: { fa: 'General', t: 'n' }, f: '=1+2' }]], config: {} },
      { name: 'First', order: 0, data: [[{ ct: { t: 'inlineStr', s: [{ v: 'mi' }, { v: 'xed' }] } }, null], [null, { v: '' }]], config: { columnlen: { '1': 82 } }, color: '#ABCDEF' },
    ];
    const model = fromGridSheets(grid);
    expect(model.sheets.map((s) => s.name)).toEqual(['First', 'Later']);
    expect(model.activeSheet).toBe(1);
    expect(model.sheets[0]!.cells).toEqual([{ r: 0, c: 0, v: 'mixed' }]);
    expect(model.sheets[0]!.tabColor).toBe('#abcdef');
    expect(model.sheets[0]!.colWidths).toEqual([{ i: 1, size: 11 }]);
    expect(model.sheets[1]!.cells).toEqual([
      { r: 0, c: 0, v: 'b', s: 0 },
      { r: 0, c: 1, v: 3, f: '1+2' },
    ]);
    expect(model.styles[0]).toEqual({ font: 'Arial', rotation: 90 });
  });

  it('the grid default font (font 0, the system sans font) stores no font; a numeric string indexes the list (D-164)', () => {
    const grid: GridSheet[] = [{ name: 'S', order: 0, data: [[{ v: 'a', ff: 0, bl: 1 }, { v: 'b', ff: '2' as never }, { v: 'c', ff: GRID_DEFAULT_FONT, it: 1 }]], config: {} }];
    const model = fromGridSheets(grid);
    expect(GRID_FONTS[0]).toBe(GRID_DEFAULT_FONT);
    expect(model.sheets[0]!.cells.map((c) => (c.s === undefined ? null : model.styles[c.s]))).toEqual([{ bold: true }, { font: 'Tahoma' }, { italic: true }]);
  });

  it('converts sizes between Excel units and pixels', () => {
    expect(widthToPx(8.43)).toBe(64);
    expect(pxToWidth(64)).toBe(8.43);
    expect(heightToPx(15)).toBe(20);
    expect(pxToHeight(20)).toBe(15);
  });
});

describe('borders drawn with the toolbar (D-140)', () => {
  const line = { style: 1, color: '#000000' };
  const thin = { style: 'thin', color: '#000000' };

  it('draws all, outside, inside and single edges over a range, later entries winning', () => {
    const borders = cellBorders([
      { rangeType: 'range', borderType: 'border-outside', ...line, range: [{ row: [0, 1], column: [0, 1] }] },
      { rangeType: 'range', borderType: 'border-inside', style: 8, color: '#ff0000', range: [{ row: [0, 1], column: [0, 1] }] },
    ]);
    const medium = { style: 'medium', color: '#ff0000' };
    expect(borders.get('0_0')).toEqual({ top: thin, left: thin, right: medium, bottom: medium });
    expect(borders.get('1_1')).toEqual({ bottom: thin, right: thin, left: medium, top: medium });
  });

  it('clears borders with border-none and takes cell entries side by side', () => {
    const borders = cellBorders([
      { rangeType: 'range', borderType: 'border-all', ...line, range: [{ row: [0, 0], column: [0, 0] }] },
      { rangeType: 'range', borderType: 'border-none', ...line, range: [{ row: [0, 0], column: [0, 0] }] },
      { rangeType: 'cell', value: { row_index: 2, col_index: 1, l: { style: 13, color: '#00FF00' }, r: null } },
    ]);
    expect(borders.get('0_0')).toEqual({});
    expect(borders.get('2_1')).toEqual({ left: { style: 'thick', color: '#00ff00' } });
  });

  it('turns borders on otherwise empty cells into styled cells of the model', () => {
    const model = fromGridSheets([{ name: 'S', order: 0, status: 1, data: [[null]], config: { borderInfo: [{ rangeType: 'range', borderType: 'border-bottom', ...line, range: [{ row: [1, 1], column: [2, 2] }] }] } }]);
    expect(model.sheets[0]!.cells).toEqual([{ r: 1, c: 2, s: 0 }]);
    expect(model.styles).toEqual([{ bottom: thin }]);
  });
});

describe('find in the spreadsheet (D-140)', () => {
  const grid = toGridSheets(workbook, WORKBOOK_LIMITS.maxGridCells);

  it('finds shown text in tab order, without hidden sheets, by case and whole cell', () => {
    expect(findInSheets(grid, 'e', { caseSensitive: false, wholeCell: false }).map((m) => [m.sheetId, m.r, m.c])).toEqual([
      ['sheet-1', 0, 0],
      ['sheet-1', 0, 2],
      ['sheet-1', 3, 0],
    ]);
    expect(findInSheets(grid, 'item', { caseSensitive: true, wholeCell: false })).toEqual([]);
    expect(findInSheets(grid, '12.50', { caseSensitive: false, wholeCell: true })).toEqual([{ sheetId: 'sheet-1', r: 0, c: 1 }]);
    expect(findInSheets(grid, 'two', { caseSensitive: false, wholeCell: true })).toEqual([{ sheetId: 'sheet-2', r: 0, c: 0 }]);
    expect(findInSheets(grid, '', { caseSensitive: false, wholeCell: false })).toEqual([]);
  });

  it('steps through matches round either end', () => {
    expect(stepMatch(3, 2, false)).toBe(0);
    expect(stepMatch(3, 0, true)).toBe(2);
    expect(stepMatch(3, -1, true)).toBe(2);
    expect(stepMatch(0, 0, false)).toBe(-1);
  });
});

describe('the grid tools (D-140)', () => {
  it('offers only tools whose results the model keeps; a CSV gets values only', () => {
    const xlsx = gridMenus(false);
    for (const left of ['conditionFormat', 'dataVerification', 'link', 'image', 'screenshot', 'search', 'splitColumn', 'locationCondition']) expect(xlsx.toolbarItems).not.toContain(left);
    for (const menu of [xlsx.cellContextMenu, xlsx.headerContextMenu]) {
      expect(menu).not.toContain('paste');
      expect(menu).not.toContain('chart');
    }
    expect(xlsx.toolbarItems).toEqual(expect.arrayContaining(['merge-cell', 'freeze', 'filter', 'border', 'comment', 'undo', 'redo']));
    const csv = gridMenus(true);
    expect(csv.toolbarItems).toEqual(['undo', 'redo']);
    expect(csv.sheetTabContextMenu).toEqual([]);
  });

  it('says what does not fit the model in the user’s words', () => {
    const bad = (change: (w: WorkbookType) => void) => {
      const w = structuredClone(workbook);
      change(w);
      const res = Workbook.safeParse(w);
      if (res.success) throw new Error('expected a problem');
      return modelProblem(res.error);
    };
    expect(bad((w) => (w.sheets[1]!.name = 'budget'))).toBe(WORKBOOK_MESSAGES.invalidSheetName);
    expect(bad((w) => (w.sheets[1]!.name = 'a:b'))).toBe(WORKBOOK_MESSAGES.invalidSheetName);
    expect(bad((w) => Object.assign(w.sheets[1]!, { rowCount: 1_000_000, colCount: 100 }))).toBe(WORKBOOK_MESSAGES.sheetTooLarge);
  });
});
