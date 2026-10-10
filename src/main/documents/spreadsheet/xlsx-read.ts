import ExcelJS from 'exceljs';
import type { BorderSideType, CellRangeType, CellStyleType, CellType, CellValueType, SheetType, SizeType, WorkbookFeature, WorkbookType } from '../../../shared/documents/workbook';
import { decodeRange, type A1Range } from './a1';
import { hexOfExcelColor, type ExcelColor } from './excel-colors';
import { WorkbookLimitError, type WorkbookLimits } from './workbook-task';

/**
 * An xlsx file as the workbook model (F3, D-134, D-136), read with ExcelJS in the workbook worker: values (dates as
 * Excel serial numbers), formulas with their last results, cell styles, notes, merges, sizes, hidden rows and columns,
 * frozen panes, the filter range, tab colors and hidden sheets. What the model does not carry is reported as features.
 * Every limit is checked while reading, so the result is bounded however the file was made.
 */

/** Excel's day zero of the 1900 date system as a JavaScript time. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
/** Default text color: left out of styles. */
const DEFAULT_TEXT = '#000000';
const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const;

// ExcelJS keeps rows, cells and merges in sparse arrays and maps without a public iterator that skips the gaps and
// keeps styled empty cells; these are read directly (exceljs is pinned, and tests cover the shapes).
interface SheetInternals {
  _rows: Array<ExcelJS.Row | undefined>;
  _merges: Record<string, { model: { top: number; left: number; bottom: number; right: number } }>;
  conditionalFormattings?: unknown[];
  dataValidations?: { model?: Record<string, unknown> };
}
interface RowInternals {
  _cells: Array<ExcelJS.Cell | undefined>;
}

export async function readXlsx(bytes: Uint8Array, limits: WorkbookLimits): Promise<{ workbook: WorkbookType; features: WorkbookFeature[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    throw new WorkbookLimitError('unreadable');
  }
  const worksheets = wb.worksheets;
  if (worksheets.length === 0) throw new WorkbookLimitError('unreadable');
  if (worksheets.length > limits.maxSheets) throw new WorkbookLimitError('tooManySheets');
  const reader = new WorkbookReader(limits);
  const sheets = worksheets.map((ws) => reader.sheet(ws));
  reader.workbookFeatures(wb);
  const wanted = wb.views?.[0]?.activeTab ?? 0;
  const visible = sheets.findIndex((s) => !s.hidden);
  const activeSheet = sheets[wanted] && !sheets[wanted].hidden ? wanted : Math.max(0, visible);
  // A workbook needs a visible sheet; one with only hidden sheets shows its first.
  if (visible < 0) sheets[0]!.hidden = false;
  return { workbook: { sheets, activeSheet, styles: reader.styles }, features: [...reader.features] };
}

class WorkbookReader {
  readonly styles: CellStyleType[] = [];
  readonly features = new Set<WorkbookFeature>();
  private readonly styleIndex = new Map<string, number>();
  private cellCount = 0;

  constructor(private readonly limits: WorkbookLimits) {}

  sheet(ws: ExcelJS.Worksheet): SheetType {
    const internals = ws as unknown as SheetInternals;
    const cells: CellType[] = [];
    const rowHeights: SizeType[] = [];
    const hiddenRows: number[] = [];
    const defaultHeight = ws.properties.defaultRowHeight ?? 15;
    const extent = { rows: 1, cols: 1 };
    const reach = (r: number, c: number) => {
      extent.rows = Math.max(extent.rows, r + 1);
      extent.cols = Math.max(extent.cols, c + 1);
    };
    for (const row of internals._rows) {
      if (!row) continue;
      const r = row.number - 1;
      if (row.hidden) hiddenRows.push(r);
      if (typeof row.height === 'number' && Math.abs(row.height - defaultHeight) > 0.01) rowHeights.push({ i: r, size: Math.min(409, Math.max(0, row.height)) });
      for (const cell of (row as unknown as RowInternals)._cells) {
        if (!cell) continue;
        const read = this.cell(cell, r, Number(cell.col) - 1);
        if (!read) continue;
        if (++this.cellCount > this.limits.maxCells) throw new WorkbookLimitError('tooManyCells');
        cells.push(read);
        reach(read.r, read.c);
      }
    }
    const merges = Object.values(internals._merges ?? {}).map((m) => rangeOf({ top: m.model.top - 1, left: m.model.left - 1, bottom: m.model.bottom - 1, right: m.model.right - 1 }));
    if (merges.length > this.limits.maxMerges) throw new WorkbookLimitError('sheetTooLarge');
    const filter = filterOf(ws.autoFilter);
    for (const m of filter ? [...merges, filter] : merges) reach(m.r + m.rows - 1, m.c + m.cols - 1);
    const view = ws.views?.[0];
    const frozen = view?.state === 'frozen' ? { rows: Math.max(0, view.ySplit ?? 0), cols: Math.max(0, view.xSplit ?? 0) } : { rows: 0, cols: 0 };
    if (frozen.rows > 0 || frozen.cols > 0) reach(Math.max(0, frozen.rows - 1), Math.max(0, frozen.cols - 1));
    if (extent.rows * extent.cols > this.limits.maxGridCells) throw new WorkbookLimitError('sheetTooLarge');

    const colWidths: SizeType[] = [];
    const hiddenCols: number[] = [];
    for (const col of ws.columns ?? []) {
      const c = (col.number ?? 0) - 1;
      if (c < 0 || c >= this.limits.maxCols) continue;
      if (col.hidden) hiddenCols.push(c);
      if (typeof col.width === 'number') colWidths.push({ i: c, size: Math.min(255, Math.max(0, col.width)) });
    }
    // Sizes and hidden rows or columns past the content widen the grid only as far as the limits allow.
    const past = (start: number, indexes: number[]) => indexes.reduce((n, i) => Math.max(n, i + 1), start);
    const props = {
      rows: past(extent.rows, [...hiddenRows, ...rowHeights.map((h) => h.i)]),
      cols: past(extent.cols, [...hiddenCols, ...colWidths.map((w) => w.i)]),
    };
    const grid = props.rows * props.cols <= this.limits.maxGridCells ? props : extent;
    this.sheetFeatures(ws, internals);
    return {
      name: ws.name,
      hidden: ws.state !== 'visible',
      tabColor: hexOfExcelColor(ws.properties.tabColor as ExcelColor | undefined),
      rowCount: grid.rows,
      colCount: grid.cols,
      cells,
      merges,
      colWidths: colWidths.filter((w) => w.i < grid.cols),
      rowHeights: rowHeights.filter((h) => h.i < grid.rows),
      hiddenRows: hiddenRows.filter((r) => r < grid.rows),
      hiddenCols: hiddenCols.filter((c) => c < grid.cols),
      frozen,
      filter,
    };
  }

  /** One cell of the model, or null for an empty cell whose style shows nothing (no fill, no border). */
  private cell(cell: ExcelJS.Cell, r: number, c: number): CellType | null {
    if (cell.type === ExcelJS.ValueType.Merge) return null;
    const content = this.content(cell);
    const style = styleOf(cell.style);
    const note = noteText(cell.note);
    if (content.v === undefined && content.f === undefined && note === undefined && !style.fill && !BORDER_SIDES.some((side) => style[side])) return null;
    if (note !== undefined && note.length > this.limits.maxNoteChars) throw new WorkbookLimitError('textTooLong');
    const out: CellType = { r, c, ...content };
    const s = this.styleId(style);
    if (s !== undefined) out.s = s;
    if (note !== undefined) out.note = note;
    return out;
  }

  private content(cell: ExcelJS.Cell): { v?: CellValueType; f?: string } {
    const value = cell.value;
    if (value === null || value === undefined) return {};
    if (typeof value !== 'object' || value instanceof Date) return { v: this.scalar(value) };
    if ('formula' in value || 'sharedFormula' in value) {
      const result = 'result' in value && value.result !== undefined ? this.result(value.result) : undefined;
      if ((value as { shareType?: string }).shareType === 'array') {
        this.features.add('arrayFormulas');
        return result === undefined ? {} : { v: result };
      }
      const formula = cell.formula;
      if (formula && formula.length > this.limits.maxFormulaChars) throw new WorkbookLimitError('textTooLong');
      return { ...(formula ? { f: formula } : {}), ...(result === undefined ? {} : { v: result }) };
    }
    if ('richText' in value) {
      this.features.add('richText');
      return { v: this.text(value.richText.map((run) => run.text).join('')) };
    }
    if ('hyperlink' in value) {
      this.features.add('hyperlinks');
      const text = value.text as unknown;
      const plain = typeof text === 'string' ? text : (text as { richText?: Array<{ text: string }> })?.richText?.map((run) => run.text).join('') ?? '';
      return { v: this.text(plain) };
    }
    if ('error' in value) return { v: String(value.error) };
    return {};
  }

  private result(result: unknown): CellValueType | undefined {
    if (result === null || result === undefined) return undefined;
    if (typeof result === 'object' && !(result instanceof Date)) return 'error' in result ? String((result as { error: unknown }).error) : undefined;
    return this.scalar(result as string | number | boolean | Date);
  }

  private scalar(value: string | number | boolean | Date): CellValueType {
    if (value instanceof Date) return (value.getTime() - EXCEL_EPOCH_MS) / DAY_MS;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new WorkbookLimitError('unreadable');
      return value;
    }
    return typeof value === 'string' ? this.text(value) : value;
  }

  private text(text: string): string {
    if (text.length > this.limits.maxTextChars) throw new WorkbookLimitError('textTooLong');
    return text;
  }

  private styleId(style: CellStyleType): number | undefined {
    const key = JSON.stringify(style);
    if (key === '{}') return undefined;
    let id = this.styleIndex.get(key);
    if (id === undefined) {
      if (this.styles.length >= this.limits.maxStyles) throw new WorkbookLimitError('sheetTooLarge');
      id = this.styles.push(style) - 1;
      this.styleIndex.set(key, id);
    }
    return id;
  }

  private sheetFeatures(ws: ExcelJS.Worksheet, internals: SheetInternals): void {
    if ((internals.conditionalFormattings?.length ?? 0) > 0) this.features.add('conditionalFormatting');
    if (Object.keys(internals.dataValidations?.model ?? {}).length > 0) this.features.add('dataValidation');
    if (ws.getImages().length > 0) this.features.add('images');
    if ((ws as unknown as { sheetProtection?: unknown }).sheetProtection) this.features.add('protection');
    const hf = ws.headerFooter as Partial<Record<string, unknown>> | undefined;
    const printing = hf && Object.values(hf).some((v) => typeof v === 'string' && v !== '');
    if (printing || ws.pageSetup?.printArea || ws.pageSetup?.printTitlesRow || ws.pageSetup?.printTitlesColumn) this.features.add('printSettings');
  }

  workbookFeatures(wb: ExcelJS.Workbook): void {
    const names = (wb.definedNames as unknown as { model: Array<{ name: string }> }).model ?? [];
    if (names.some((n) => !n.name.startsWith('_xlnm.'))) this.features.add('namedRanges');
    if (names.some((n) => /^_xlnm\.Print_/i.test(n.name))) this.features.add('printSettings');
  }
}

function rangeOf(a: A1Range): CellRangeType {
  return { r: a.top, c: a.left, rows: a.bottom - a.top + 1, cols: a.right - a.left + 1 };
}

/** The filter range of a sheet: `A1:C9`, or `{from, to}` as addresses or row and column numbers. */
function filterOf(filter: ExcelJS.AutoFilter | undefined): CellRangeType | null {
  if (!filter) return null;
  if (typeof filter === 'string') {
    const range = decodeRange(filter);
    return range ? rangeOf(range) : null;
  }
  const corner = (end: string | { row: number; column: number }) => (typeof end === 'string' ? decodeRange(end) : { top: end.row - 1, left: end.column - 1, bottom: end.row - 1, right: end.column - 1 });
  const from = corner(filter.from as string | { row: number; column: number });
  const to = corner(filter.to as string | { row: number; column: number });
  if (!from || !to || from.top < 0 || from.left < 0) return null;
  return rangeOf({ top: Math.min(from.top, to.top), left: Math.min(from.left, to.left), bottom: Math.max(from.bottom, to.bottom), right: Math.max(from.right, to.right) });
}

function noteText(note: ExcelJS.Cell['note'] | undefined): string | undefined {
  if (!note) return undefined;
  const text = typeof note === 'string' ? note : (note.texts ?? []).map((t) => t.text).join('');
  return text === '' ? undefined : text;
}

function borderOf(border: Partial<ExcelJS.Border> | undefined): BorderSideType | undefined {
  if (!border?.style) return undefined;
  return { style: border.style, color: hexOfExcelColor(border.color as ExcelColor | undefined) ?? DEFAULT_TEXT };
}

function fillOf(fill: ExcelJS.Fill | undefined): string | null {
  if (!fill) return null;
  if (fill.type === 'pattern') return fill.pattern === 'none' ? null : hexOfExcelColor((fill.fgColor ?? fill.bgColor) as ExcelColor | undefined);
  return hexOfExcelColor(fill.stops[0]?.color as ExcelColor | undefined);
}

const H_ALIGN: Partial<Record<string, CellStyleType['hAlign']>> = { left: 'left', center: 'center', centerContinuous: 'center', right: 'right', justify: 'left', distributed: 'center', fill: 'left' };
const V_ALIGN: Partial<Record<string, CellStyleType['vAlign']>> = { top: 'top', middle: 'middle', bottom: 'bottom', distributed: 'middle', justify: 'middle' };

/** The model style of an ExcelJS style; default values are left out. */
export function styleOf(style: Partial<ExcelJS.Style> | undefined): CellStyleType {
  const out: CellStyleType = {};
  const font = style?.font;
  if (font?.name) out.font = font.name.slice(0, 64);
  if (typeof font?.size === 'number' && font.size >= 1) out.size = Math.min(409, font.size);
  if (font?.bold) out.bold = true;
  if (font?.italic) out.italic = true;
  if (font?.underline && font.underline !== 'none') out.underline = true;
  if (font?.strike) out.strike = true;
  const color = hexOfExcelColor(font?.color as ExcelColor | undefined);
  if (color && color !== DEFAULT_TEXT) out.color = color;
  const fill = fillOf(style?.fill);
  if (fill) out.fill = fill;
  if (style?.numFmt && style.numFmt !== 'General') out.numFmt = style.numFmt.slice(0, 255);
  const align = style?.alignment;
  const h = align?.horizontal ? H_ALIGN[align.horizontal] : undefined;
  if (h) out.hAlign = h;
  const v = align?.vertical ? V_ALIGN[align.vertical] : undefined;
  if (v && v !== 'bottom') out.vAlign = v;
  if (align?.wrapText) out.wrap = true;
  if (typeof align?.textRotation === 'number' && align.textRotation !== 0) out.rotation = Math.max(-90, Math.min(90, Math.round(align.textRotation)));
  for (const side of BORDER_SIDES) {
    const border = borderOf(style?.border?.[side]);
    if (border) out[side] = border;
  }
  return out;
}
