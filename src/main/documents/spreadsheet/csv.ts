import type { CellType, CsvFormatType, SheetType, WorkbookType } from '../../../shared/documents/workbook';
import { WorkbookLimitError, type WorkbookLimits } from './workbook-task';

/**
 * CSV and TSV files as one-sheet workbooks (F3, D-135): RFC 4180 quoting (separators, quotes and line breaks inside
 * quoted fields, doubled quotes), the separator detected from the first lines, and the file written back with the
 * separator, encoding, byte-order mark and line breaks it was read with. Values only: no formulas or formatting.
 */

const DELIMITERS = [',', ';', '\t', '|'] as const;
type Delimiter = (typeof DELIMITERS)[number];
/** Lines looked at to choose the separator. */
const SAMPLE_LINES = 50;

/** The separator that splits the first lines most consistently into more than one field, outside quotes. */
export function detectDelimiter(text: string): Delimiter {
  const lines: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length && lines.length < SAMPLE_LINES; i += 1) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      lines.push(text.slice(start, i));
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      start = i + 1;
    }
  }
  if (lines.length < SAMPLE_LINES && start < text.length) lines.push(text.slice(start));
  let best: { delimiter: Delimiter; score: number } = { delimiter: ',', score: 0 };
  for (const delimiter of DELIMITERS) {
    const counts = lines.filter((l) => l !== '').map((l) => countOutsideQuotes(l, delimiter));
    if (counts.length === 0 || counts[0] === 0) continue;
    // Lines with the same count as the first one; a header row decides the shape.
    const consistent = counts.filter((n) => n === counts[0]).length / counts.length;
    const score = consistent * 1000 + counts[0]!;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let n = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === delimiter) n += 1;
  }
  return n;
}

/** The rows of CSV text; a quote opens a quoted field only at its start. */
export function parseCsv(text: string, delimiter: string, limits: WorkbookLimits): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let atFieldStart = true;
  let cells = 0;
  const endField = () => {
    if (field.length > limits.maxTextChars) throw new WorkbookLimitError('textTooLong');
    row.push(field);
    field = '';
    atFieldStart = true;
    if (row.length > limits.maxCols) throw new WorkbookLimitError('sheetTooLarge');
  };
  const endRow = () => {
    endField();
    cells += row.length;
    // Every field counts, empty ones too: the grid holds them all.
    if (cells > limits.maxGridCells || rows.length >= limits.maxRows) throw new WorkbookLimitError('sheetTooLarge');
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (ch === delimiter) endField();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += ch;
      atFieldStart = false;
    }
  }
  if (field !== '' || row.length > 0 || quoted) endRow();
  return rows;
}

/** A number when the text is exactly how JavaScript writes that number ("12", "-3.5"), so writing it back is identical. */
function valueOf(text: string): string | number {
  if (text === '' || text.length > 24) return text;
  const n = Number(text);
  return Number.isFinite(n) && String(n) === text ? n : text;
}

/** The one-sheet workbook of a CSV file's text. */
export function csvToWorkbook(text: string, delimiter: string, limits: WorkbookLimits): WorkbookType {
  const rows = parseCsv(text, delimiter, limits);
  const cells: CellType[] = [];
  let colCount = 1;
  rows.forEach((fields, r) =>
    fields.forEach((field, c) => {
      if (field === '') return;
      cells.push({ r, c, v: valueOf(field) });
      colCount = Math.max(colCount, c + 1);
    }),
  );
  if (cells.length > limits.maxCells) throw new WorkbookLimitError('tooManyCells');
  const rowCount = Math.max(1, rows.length);
  if (rowCount * colCount > limits.maxGridCells) throw new WorkbookLimitError('sheetTooLarge');
  const sheet: SheetType = {
    name: 'Sheet1',
    hidden: false,
    tabColor: null,
    rowCount,
    colCount,
    cells,
    merges: [],
    colWidths: [],
    rowHeights: [],
    hiddenRows: [],
    hiddenCols: [],
    frozen: { rows: 0, cols: 0 },
    filter: null,
  };
  return { sheets: [sheet], activeSheet: 0, styles: [] };
}

/** How the text ends its lines, and whether its last line has a break. */
export function lineFormat(text: string): Pick<CsvFormatType, 'lineEnding' | 'finalNewline'> {
  const lf = text.indexOf('\n');
  return { lineEnding: lf > 0 && text[lf - 1] === '\r' ? '\r\n' : lf >= 0 ? '\n' : '\r\n', finalNewline: /[\r\n]$/.test(text) };
}

function fieldText(cell: CellType | undefined): string {
  const v = cell?.v;
  if (v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

/**
 * The CSV text of a workbook's first sheet: its values (formula results). Every row has as many fields as the widest
 * row, as spreadsheet apps write them; empty rows and columns after the last value are left out. Fields are quoted
 * only when they hold the separator, a quote or a line break.
 */
export function workbookToCsv(workbook: WorkbookType, format: Pick<CsvFormatType, 'delimiter' | 'lineEnding' | 'finalNewline'>): string {
  const sheet = workbook.sheets[0]!;
  const grid = new Map<number, Map<number, CellType>>();
  let lastRow = -1;
  let lastCol = -1;
  for (const cell of sheet.cells) {
    if (fieldText(cell) === '') continue;
    let row = grid.get(cell.r);
    if (!row) grid.set(cell.r, (row = new Map()));
    row.set(cell.c, cell);
    lastRow = Math.max(lastRow, cell.r);
    lastCol = Math.max(lastCol, cell.c);
  }
  const quote = (text: string) =>
    text.includes(format.delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r') ? `"${text.replaceAll('"', '""')}"` : text;
  const lines: string[] = [];
  for (let r = 0; r <= lastRow; r += 1) {
    const row = grid.get(r);
    const fields: string[] = [];
    for (let c = 0; c <= lastCol; c += 1) fields.push(quote(fieldText(row?.get(c))));
    lines.push(fields.join(format.delimiter));
  }
  const text = lines.join(format.lineEnding);
  return format.finalNewline && lines.length > 0 ? text + format.lineEnding : text;
}

/** Windows-1252 code points 0x80-0x9F; the other bytes are Latin-1. */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

function encodeWindows1252(text: string): Uint8Array | null {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const high = CP1252_HIGH.indexOf(text[i]!);
    if (high >= 0) out[i] = 0x80 + high;
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out[i] = code;
    else return null;
  }
  return out;
}

function encodeUtf16(text: string, bigEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i += 1) view.setUint16(i * 2, text.charCodeAt(i), !bigEndian);
  return out;
}

const BOM: Record<Exclude<CsvFormatType['encoding'], 'windows-1252'>, number[]> = { 'utf-8': [0xef, 0xbb, 0xbf], 'utf-16le': [0xff, 0xfe], 'utf-16be': [0xfe, 0xff] };

/**
 * The bytes of CSV text in the file's encoding, with its byte-order mark when it had one. Text that Windows-1252
 * cannot hold (a character typed in the grid) is written as UTF-8 with a mark instead, so nothing is lost.
 */
export function encodeCsv(text: string, format: Pick<CsvFormatType, 'encoding' | 'bom'>): Uint8Array {
  if (format.encoding === 'windows-1252') {
    const body = encodeWindows1252(text);
    return body ?? encodeCsv(text, { encoding: 'utf-8', bom: true });
  }
  const body = format.encoding === 'utf-8' ? new TextEncoder().encode(text) : encodeUtf16(text, format.encoding === 'utf-16be');
  const mark = format.bom ? BOM[format.encoding] : [];
  const bytes = new Uint8Array(mark.length + body.length);
  bytes.set(mark, 0);
  bytes.set(body, mark.length);
  return bytes;
}
