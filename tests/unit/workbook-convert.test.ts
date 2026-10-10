import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it } from 'vitest';
import { runWorkbookTask } from '../../src/main/documents/spreadsheet/workbook-convert';
import type { WorkbookLimits, WorkbookReply } from '../../src/main/documents/spreadsheet/workbook-task';
import { readXlsx } from '../../src/main/documents/spreadsheet/xlsx-read';
import { writeXlsx } from '../../src/main/documents/spreadsheet/xlsx-write';
import { hexOfExcelColor } from '../../src/main/documents/spreadsheet/excel-colors';
import { Workbook, WORKBOOK_LIMITS, type WorkbookType } from '../../src/shared/documents/workbook';
import { fromGridSheets, toGridSheets } from '../../src/renderer/documents/spreadsheet/fortune-model';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-workbook-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const temp = (bytes: Uint8Array | Buffer, ext = 'xlsx') => {
  const file = path.join(dir, `f${(n += 1)}.${ext}`);
  fs.writeFileSync(file, bytes);
  return file;
};

/** A workbook made with ExcelJS the way Excel files carry each feature the model keeps. */
async function richWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Budget', { properties: { tabColor: { argb: 'FF00B050' } }, views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
  ws.getCell('A1').value = 'Item';
  ws.getCell('A1').font = { name: 'Arial', size: 14, bold: true, italic: true, underline: true, color: { argb: 'FFC00000' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  ws.getCell('A1').border = { top: { style: 'thin', color: { argb: 'FF0000FF' } }, bottom: { style: 'double', color: { argb: 'FF000000' } } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
  ws.getCell('A1').note = 'Header note';
  ws.getCell('B1').value = 12.5;
  ws.getCell('B1').numFmt = '0.00';
  ws.getCell('B2').value = 7;
  ws.getCell('B3').value = { formula: 'SUM(B1:B2)', result: 19.5 };
  ws.getCell('C1').value = true;
  ws.getCell('C2').value = new Date(Date.UTC(2026, 9, 10));
  ws.getCell('C2').numFmt = 'yyyy-mm-dd';
  ws.getCell('D1').value = 'Turned';
  ws.getCell('D1').alignment = { textRotation: 45 };
  ws.getCell('E5').fill = { type: 'pattern', pattern: 'solid', fgColor: { theme: 4 } };
  ws.mergeCells('A4:B5');
  ws.getCell('A4').value = 'Merged';
  ws.getColumn(1).width = 20;
  ws.getColumn(3).hidden = true;
  ws.getRow(2).height = 30;
  // Excel writes a height for an empty hidden row; ExcelJS would drop the row without one.
  ws.getRow(6).hidden = true;
  ws.getRow(6).height = 15;
  ws.autoFilter = 'A1:D3';
  const second = wb.addWorksheet('Notes', { state: 'hidden' });
  second.getCell('A1').value = 'Hidden sheet';
  wb.addWorksheet('Third').getCell('B2').value = 'x';
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function read(bytes: Uint8Array, limits: WorkbookLimits = WORKBOOK_LIMITS) {
  return readXlsx(bytes, limits);
}

describe('xlsx to the workbook model (D-134)', () => {
  it('reads values, formulas, dates, styles, notes, merges, sizes, hidden rows and columns, panes, filters and sheets', async () => {
    const { workbook, features } = await read(await richWorkbook());
    expect(Workbook.safeParse(workbook).success).toBe(true);
    expect(features).toEqual([]);
    expect(workbook.sheets.map((s) => [s.name, s.hidden])).toEqual([
      ['Budget', false],
      ['Notes', true],
      ['Third', false],
    ]);
    const sheet = workbook.sheets[0]!;
    const cell = (r: number, c: number) => sheet.cells.find((x) => x.r === r && x.c === c);
    const style = (r: number, c: number) => workbook.styles[cell(r, c)!.s!];
    expect(cell(0, 0)).toMatchObject({ v: 'Item', note: 'Header note' });
    expect(style(0, 0)).toEqual({
      font: 'Arial',
      size: 14,
      bold: true,
      italic: true,
      underline: true,
      color: '#c00000',
      fill: '#ffff00',
      hAlign: 'center',
      vAlign: 'top',
      wrap: true,
      top: { style: 'thin', color: '#0000ff' },
      bottom: { style: 'double', color: '#000000' },
    });
    expect(cell(0, 1)).toMatchObject({ v: 12.5 });
    expect(style(0, 1)).toMatchObject({ numFmt: '0.00' });
    expect(cell(2, 1)).toMatchObject({ f: 'SUM(B1:B2)', v: 19.5 });
    expect(cell(0, 2)).toMatchObject({ v: true });
    // 2026-10-10 is Excel day 46305.
    expect(cell(1, 2)).toMatchObject({ v: 46305 });
    expect(style(1, 2)).toMatchObject({ numFmt: 'yyyy-mm-dd' });
    expect(style(0, 3)).toMatchObject({ rotation: 45 });
    // A filled empty cell is kept; the theme color is the Office accent 1.
    expect(cell(4, 4)?.v).toBeUndefined();
    expect(style(4, 4)).toMatchObject({ fill: '#4472c4' });
    expect(sheet.merges).toEqual([{ r: 3, c: 0, rows: 2, cols: 2 }]);
    expect(sheet.colWidths).toContainEqual({ i: 0, size: 20 });
    expect(sheet.hiddenCols).toEqual([2]);
    expect(sheet.rowHeights).toContainEqual({ i: 1, size: 30 });
    expect(sheet.hiddenRows).toEqual([5]);
    expect(sheet.frozen).toEqual({ rows: 2, cols: 1 });
    expect(sheet.filter).toEqual({ r: 0, c: 0, rows: 3, cols: 4 });
    expect(sheet.tabColor).toBe('#00b050');
    expect(sheet.rowCount).toBeGreaterThanOrEqual(6);
    expect(sheet.colCount).toBeGreaterThanOrEqual(5);
  });

  it('writes the model back so that reading it again gives the same model', async () => {
    const first = (await read(await richWorkbook())).workbook;
    const written = await writeXlsx(first);
    const again = (await read(written)).workbook;
    expect(again).toEqual(first);
  });

  it('survives the grid: what main reads comes back from FortuneSheet unchanged and writes the same file', async () => {
    const read = (await readXlsx(await richWorkbook(), WORKBOOK_LIMITS)).workbook;
    const back = fromGridSheets(toGridSheets(read, WORKBOOK_LIMITS.maxGridCells));
    expect(back).toEqual(read);
    expect((await readXlsx(await writeXlsx(back), WORKBOOK_LIMITS)).workbook).toEqual(read);
  });

  it('writes an edited model: new values, formulas, styles and merges reach the file', async () => {
    const model: WorkbookType = {
      activeSheet: 1,
      styles: [{ font: 'Courier New', size: 9, strike: true, color: '#336699', fill: '#eeeeee', hAlign: 'right', right: { style: 'medium', color: '#ff0000' } }],
      sheets: [
        { ...emptySheet('First'), cells: [{ r: 0, c: 0, v: 2 }, { r: 1, c: 0, v: 3 }, { r: 2, c: 0, f: 'A1*A2', v: 6, s: 0 }], merges: [{ r: 0, c: 1, rows: 1, cols: 3 }] },
        { ...emptySheet('Second'), cells: [{ r: 0, c: 0, v: 'two', note: 'n' }] },
      ],
    };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await writeXlsx(model)) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('First')!;
    expect(ws.getCell('A3').formula).toBe('A1*A2');
    expect(ws.getCell('A3').result).toBe(6);
    expect(ws.getCell('A3').font).toMatchObject({ name: 'Courier New', size: 9, strike: true, color: { argb: 'FF336699' } });
    expect(ws.getCell('A3').border.right).toMatchObject({ style: 'medium' });
    expect(ws.getCell('C1').isMerged).toBe(true);
    expect(wb.views[0]?.activeTab).toBe(1);
    expect(wb.getWorksheet('Second')!.getCell('A1').note).toBe('n');
  });

  it('lists what the model does not carry', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.getCell('A1').value = { richText: [{ text: 'bold', font: { bold: true } }, { text: ' plain' }] };
    ws.getCell('A2').value = { text: 'site', hyperlink: 'https://example.invalid/' };
    ws.getCell('A3').dataValidation = { type: 'list', allowBlank: true, formulae: ['"a,b"'] };
    ws.addConditionalFormatting({ ref: 'B1:B3', rules: [{ type: 'expression', priority: 1, formulae: ['B1>1'], style: { font: { bold: true } } }] });
    wb.definedNames.add('S!$A$1', 'Total');
    ws.headerFooter.oddFooter = 'Page &P';
    const { workbook, features } = await read(new Uint8Array(await wb.xlsx.writeBuffer()));
    expect(new Set(features)).toEqual(new Set(['richText', 'hyperlinks', 'dataValidation', 'conditionalFormatting', 'namedRanges', 'printSettings']));
    // The text of rich text and links stays.
    expect(workbook.sheets[0]!.cells.slice(0, 2).map((c) => c.v)).toEqual(['bold plain', 'site']);
  });

  it('refuses workbooks past the limits, and files that are not workbooks', async () => {
    const bytes = await richWorkbook();
    await expect(read(bytes, { ...WORKBOOK_LIMITS, maxSheets: 2 })).rejects.toMatchObject({ code: 'tooManySheets' });
    await expect(read(bytes, { ...WORKBOOK_LIMITS, maxCells: 5 })).rejects.toMatchObject({ code: 'tooManyCells' });
    await expect(read(bytes, { ...WORKBOOK_LIMITS, maxGridCells: 10 })).rejects.toMatchObject({ code: 'sheetTooLarge' });
    await expect(read(bytes, { ...WORKBOOK_LIMITS, maxTextChars: 3 })).rejects.toMatchObject({ code: 'textTooLong' });
    await expect(read(new TextEncoder().encode('not a zip'))).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('answers through the worker task with codes only', async () => {
    const reply = await runWorkbookTask({ op: 'readXlsx', file: temp(new TextEncoder().encode('nope')), limits: WORKBOOK_LIMITS });
    expect(reply).toEqual({ ok: false, error: 'unreadable' });
    const ok = (await runWorkbookTask({ op: 'readXlsx', file: path.resolve('tests/fixtures/documents/sample.xlsx'), limits: WORKBOOK_LIMITS })) as Extract<WorkbookReply, { read: unknown }>;
    expect(ok.ok).toBe(true);
    expect(ok.read.csv).toBeNull();
    expect(Workbook.safeParse(ok.read.workbook).success).toBe(true);
  });

  it('maps theme, tinted and indexed colors', () => {
    expect(hexOfExcelColor({ argb: 'FF123456' })).toBe('#123456');
    expect(hexOfExcelColor({ theme: 1 })).toBe('#000000');
    expect(hexOfExcelColor({ theme: 0, tint: -0.5 })).toBe('#808080');
    expect(hexOfExcelColor({ indexed: 10 })).toBe('#ff0000');
    expect(hexOfExcelColor({ indexed: 200 })).toBeNull();
    expect(hexOfExcelColor(undefined)).toBeNull();
  });
});

function emptySheet(name: string): WorkbookType['sheets'][number] {
  return {
    name,
    hidden: false,
    tabColor: null,
    rowCount: 10,
    colCount: 5,
    cells: [],
    merges: [],
    colWidths: [],
    rowHeights: [],
    hiddenRows: [],
    hiddenCols: [],
    frozen: { rows: 0, cols: 0 },
    filter: null,
  };
}

describe('the workbook contract', () => {
  const base = (): WorkbookType => ({ activeSheet: 0, styles: [{ bold: true }], sheets: [{ ...emptySheet('A'), cells: [{ r: 1, c: 1, v: 1, s: 0 }] }] });

  it('accepts a valid workbook', () => {
    expect(Workbook.safeParse(base()).success).toBe(true);
  });

  it.each([
    ['a cell outside its sheet', (w: WorkbookType) => (w.sheets[0]!.cells = [{ r: 10, c: 0, v: 1 }])],
    ['a style index that does not exist', (w: WorkbookType) => (w.sheets[0]!.cells[0]!.s = 1)],
    ['sheet names equal but for case', (w: WorkbookType) => w.sheets.push({ ...emptySheet('a') })],
    ['a forbidden sheet name character', (w: WorkbookType) => (w.sheets[0]!.name = 'A/B')],
    ['a merge past the sheet', (w: WorkbookType) => (w.sheets[0]!.merges = [{ r: 9, c: 0, rows: 2, cols: 1 }])],
    ['a grid larger than the limit', (w: WorkbookType) => Object.assign(w.sheets[0]!, { rowCount: 100_000, colCount: 100 })],
    ['no such active sheet', (w: WorkbookType) => (w.activeSheet = 1)],
    ['a text longer than Excel allows', (w: WorkbookType) => (w.sheets[0]!.cells[0]!.v = 'x'.repeat(WORKBOOK_LIMITS.maxTextChars + 1))],
    ['a number that is not finite', (w: WorkbookType) => (w.sheets[0]!.cells[0]!.v = Number.POSITIVE_INFINITY)],
    ['a color that is not #rrggbb', (w: WorkbookType) => (w.styles[0]!.color = 'red')],
  ])('refuses %s', (_name, change) => {
    const w = base();
    change(w);
    expect(Workbook.safeParse(w).success).toBe(false);
  });
});
