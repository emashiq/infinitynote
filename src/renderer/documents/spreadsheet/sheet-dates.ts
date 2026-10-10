import { is_date as isDateFormat, setTextValueParser, update as formatValue } from '@fortune-sheet/core';
import type { CellStyleType, CellType, WorkbookType } from '../../../shared/documents/workbook';
import { parseTypedDate, type DateOrder } from '../../../shared/time/typed-date';

/**
 * Dates typed into the grid (D-184): FortuneSheet itself reads only yyyy-mm-dd, so "25.10.2026" stayed text. The grid
 * reads typed text through the build patch's hook first: a date in one of the typed-date forms becomes its day number
 * with a date format that shows it as it was typed; anything else is left to FortuneSheet. Day and month follow the
 * computer's date order where both could be either.
 */
export function readTypedDates(order: DateOrder): void {
  setTextValueParser((text) => {
    const date = parseTypedDate(text, order);
    return date ? [String(formatValue(date.format, date.serial)), { fa: date.format, t: 'd' }, date.serial] : null;
  });
}

/**
 * CSV keeps no formats (D-135), so dates are written as they are shown: a date cell's value becomes its text and its
 * style goes. Reading the file again turns that text back into the same date (csvDatesFromText).
 */
export function csvDatesAsText(workbook: WorkbookType): WorkbookType {
  const sheets = workbook.sheets.map((sheet) => ({
    ...sheet,
    cells: sheet.cells.map((cell): CellType => {
      const numFmt = cell.s === undefined ? undefined : workbook.styles[cell.s]?.numFmt;
      if (typeof cell.v !== 'number' || !numFmt || !isDateFormat(numFmt)) return cell;
      const { s: _style, ...rest } = cell;
      return { ...rest, v: String(formatValue(numFmt, cell.v)) };
    }),
  }));
  return { ...workbook, sheets };
}

/**
 * The cells of a CSV file whose text is a typed date get that date, with the format that shows the same text; text that
 * would not come back exactly the same ("2:30 pm" shows as "2:30 PM") stays text, so saving an untouched file writes the
 * same bytes.
 */
export function csvDatesFromText(workbook: WorkbookType, order: DateOrder): WorkbookType {
  const styles: CellStyleType[] = [...workbook.styles];
  const styleOf = new Map<string, number>();
  const sheets = workbook.sheets.map((sheet) => ({
    ...sheet,
    cells: sheet.cells.map((cell): CellType => {
      if (typeof cell.v !== 'string' || cell.f !== undefined || cell.s !== undefined) return cell;
      const date = parseTypedDate(cell.v, order);
      if (!date || String(formatValue(date.format, date.serial)) !== cell.v) return cell;
      let s = styleOf.get(date.format);
      if (s === undefined) {
        s = styles.push({ numFmt: date.format }) - 1;
        styleOf.set(date.format, s);
      }
      return { ...cell, v: date.serial, s };
    }),
  }));
  return { ...workbook, sheets, styles };
}
