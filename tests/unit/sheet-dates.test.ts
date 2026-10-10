import { genarate, setTextValueParser, type Sheet as GridSheet } from '@fortune-sheet/core';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { csvDatesAsText, csvDatesFromText, readTypedDates } from '../../src/renderer/documents/spreadsheet/sheet-dates';
import { fromGridSheets, toGridSheets } from '../../src/renderer/documents/spreadsheet/fortune-model';
import { readXlsx } from '../../src/main/documents/spreadsheet/xlsx-read';
import { writeXlsx } from '../../src/main/documents/spreadsheet/xlsx-write';
import { workbookToCsv, csvToWorkbook } from '../../src/main/documents/spreadsheet/csv';
import { WORKBOOK_LIMITS, type SheetType, type WorkbookType } from '../../src/shared/documents/workbook';

afterEach(() => setTextValueParser(null));

const OCT_10_2026 = 46305;
const OCT_25_2026 = 46320;

/** A one-sheet grid with the cells FortuneSheet makes of typed text (genarate's reading, as the grid stores it). */
function typedGrid(texts: string[]): GridSheet[] {
  return [
    {
      name: 'Sheet1',
      id: 's1',
      order: 0,
      celldata: texts.map((text, r) => {
        const [m, ct, v] = genarate(text) as [string, { fa: string; t: string }, unknown];
        return { r, c: 0, v: { v, m, ct } };
      }),
    } as GridSheet,
  ];
}

function sheet(cells: SheetType['cells']): SheetType {
  return { name: 'Sheet1', hidden: false, tabColor: null, rowCount: 10, colCount: 3, cells, merges: [], colWidths: [], rowHeights: [], hiddenRows: [], hiddenCols: [], frozen: { rows: 0, cols: 0 }, filter: null };
}

describe('dates typed into a spreadsheet (D-184)', () => {
  it('the grid reads typed dates in the computer order and shows them as typed', () => {
    readTypedDates('day-first');
    expect(genarate('10-10-2026')).toEqual(['10-10-2026', { fa: 'dd-mm-yyyy', t: 'd' }, OCT_10_2026]);
    expect(genarate('25.10.2026')).toEqual(['25.10.2026', { fa: 'dd"."mm"."yyyy', t: 'd' }, OCT_25_2026]);
    expect(genarate('25-10-2026 14:30')).toEqual(['25-10-2026 14:30', { fa: 'dd-mm-yyyy hh:mm', t: 'd' }, OCT_25_2026 + 14.5 / 24]);
    expect(genarate('05/10/2026')).toEqual(['05/10/2026', { fa: 'dd/mm/yyyy', t: 'd' }, OCT_10_2026 - 5]);
    readTypedDates('month-first');
    expect(genarate('05/10/2026')).toEqual(['05/10/2026', { fa: 'mm/dd/yyyy', t: 'd' }, 46152]);
    expect(genarate('25.10.2026')?.[2]).toBe(OCT_25_2026);
    // Not a date: left to FortuneSheet (text, numbers, an impossible date).
    expect(genarate('31-02-2026')).toEqual(['31-02-2026', { fa: 'General', t: 'g' }, '31-02-2026']);
    expect(genarate('12.5')).toEqual(['12.5', { fa: '0.0', t: 'n' }, 12.5]);
    expect(genarate('hello')).toEqual(['hello', { fa: 'General', t: 'g' }, 'hello']);
  });

  it('an xlsx keeps the day number and the date format, and shows the date as typed when opened again', async () => {
    readTypedDates('day-first');
    const model = fromGridSheets(typedGrid(['10-10-2026', '25.10.2026', '10/25/2026 2:30 PM']));
    const bytes = await writeXlsx(model);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A1').value).toEqual(new Date(Date.UTC(2026, 9, 10)));
    expect(ws.getCell('A1').numFmt).toBe('dd-mm-yyyy');
    expect(ws.getCell('A2').numFmt).toBe('dd"."mm"."yyyy');
    expect(ws.getCell('A3').numFmt).toBe('mm/dd/yyyy h:mm AM/PM');
    const reopened = toGridSheets((await readXlsx(bytes, WORKBOOK_LIMITS)).workbook, WORKBOOK_LIMITS.maxGridCells)[0]!;
    expect(reopened.celldata?.map((d) => [d.v?.m, d.v?.ct?.t])).toEqual([
      ['10-10-2026', 'd'],
      ['25.10.2026', 'd'],
      ['10/25/2026 2:30 PM', 'd'],
    ]);
  });

  it('a CSV writes dates as shown and reads that text back as the same dates', () => {
    readTypedDates('day-first');
    const edited = fromGridSheets(typedGrid(['10-10-2026', '25.10.2026', 'Total']));
    const text = workbookToCsv(csvDatesAsText(edited), { delimiter: ',', lineEnding: '\n', finalNewline: true });
    expect(text).toBe('10-10-2026\n25.10.2026\nTotal\n');
    const opened = csvDatesFromText(csvToWorkbook(text, ',', WORKBOOK_LIMITS), 'day-first');
    expect(opened.sheets[0]!.cells.map((c) => [c.v, c.s === undefined ? null : opened.styles[c.s]?.numFmt])).toEqual([
      [OCT_10_2026, 'dd-mm-yyyy'],
      [OCT_25_2026, 'dd"."mm"."yyyy'],
      ['Total', null],
    ]);
    // Saving it untouched writes the same text.
    expect(workbookToCsv(csvDatesAsText(opened), { delimiter: ',', lineEnding: '\n', finalNewline: true })).toBe(text);
  });

  it('CSV text that would not come back the same stays text', () => {
    const workbook: WorkbookType = { activeSheet: 0, styles: [], sheets: [sheet([{ r: 0, c: 0, v: '10/25/2026 2:30 pm' }, { r: 1, c: 0, v: '31-02-2026' }])] };
    expect(csvDatesFromText(workbook, 'month-first').sheets[0]!.cells).toEqual(workbook.sheets[0]!.cells);
  });
});
