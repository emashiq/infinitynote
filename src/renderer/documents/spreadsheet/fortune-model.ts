import { is_date as isDateFormat, update as formatValue, type Cell as GridCell, type CellWithRowAndCol, type Sheet as GridSheet } from '@fortune-sheet/core';
import {
  BORDER_STYLES,
  type BorderSideType,
  type BorderStyle,
  type CellRangeType,
  type CellStyleType,
  type CellType,
  type CellValueType,
  type SheetType,
  type SizeType,
  type WorkbookType,
} from '../../../shared/documents/workbook';

/**
 * The workbook model (D-134) as FortuneSheet's sheets and back (D-140). FortuneSheet keeps styles on each cell, sizes
 * in pixels, merges and borders in the sheet's config, and frozen panes as a focus cell; the model keeps a style table,
 * Excel's units and plain ranges. Converting a model to the grid and back gives the same model, except that column
 * widths and row heights are rounded to whole pixels.
 */

/** FortuneSheet's border style numbers (its `setLineDash` table). */
const GRID_BORDER: Record<BorderStyle, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
};
const MODEL_BORDER = new Map<number, BorderStyle>(BORDER_STYLES.map((s) => [GRID_BORDER[s], s]));
/**
 * The grid's default font (D-164): FortuneSheet draws a cell without a font, and font 0 of its menu, in the first font of
 * its list, which is Times New Roman; the viewer makes it the system's sans font, the one the app's text uses.
 */
export const GRID_DEFAULT_FONT = 'system-ui';
/** FortuneSheet's English font list as the viewer sets it; a numeric `ff` indexes it, and 0 (the default) stores no font. */
export const GRID_FONTS: readonly string[] = [GRID_DEFAULT_FONT, 'Arial', 'Tahoma', 'Verdana'];
const H_ALIGN = { center: 0, left: 1, right: 2 } as const;
const V_ALIGN = { middle: 0, top: 1, bottom: 2 } as const;
/** FortuneSheet's `tr` presets in degrees. */
const ROTATION_PRESETS: Record<string, number> = { '1': 45, '2': -45, '4': 90, '5': -90 };
/** Excel's error values, which a formula result may be. */
const EXCEL_ERRORS = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#SPILL!', '#CALC!', '#GETTING_DATA']);
/** Rows and columns shown past the content, so there is room to type. */
const GRID_MARGIN = { rows: 50, cols: 10, minRows: 100, minCols: 26 };

/** Excel column width (characters of the default font) and row height (points) in grid pixels, and back. */
export const widthToPx = (chars: number): number => Math.round(chars * 7 + 5);
export const pxToWidth = (px: number): number => Math.max(0, Math.round(((px - 5) / 7) * 100) / 100);
export const heightToPx = (pt: number): number => Math.round((pt * 4) / 3);
export const pxToHeight = (px: number): number => Math.round(px * 0.75 * 100) / 100;

type BorderSides = 'top' | 'right' | 'bottom' | 'left';
const GRID_SIDE: Record<BorderSides, 't' | 'r' | 'b' | 'l'> = { top: 't', right: 'r', bottom: 'b', left: 'l' };

// Model to grid ---------------------------------------------------------------------------------------------------------

function displayOf(v: CellValueType, numFmt: string): { m: string; ct: { fa: string; t: string } } {
  if (typeof v === 'boolean') return { m: v ? 'TRUE' : 'FALSE', ct: { fa: 'General', t: 'b' } };
  if (typeof v === 'string') return { m: v, ct: { fa: numFmt === '@' ? '@' : 'General', t: EXCEL_ERRORS.has(v) ? 'e' : 's' } };
  let m: string;
  try {
    m = String(formatValue(numFmt, v));
  } catch {
    m = String(v);
  }
  return { m, ct: { fa: numFmt, t: numFmt !== 'General' && isDateFormat(numFmt) ? 'd' : 'n' } };
}

function gridCellOf(cell: CellType, style: CellStyleType | undefined): GridCell {
  const out: GridCell = {};
  const numFmt = style?.numFmt ?? 'General';
  if (cell.v !== undefined) {
    const { m, ct } = displayOf(cell.v, numFmt);
    Object.assign(out, { v: cell.v, m, ct });
  } else if (style?.numFmt) out.ct = { fa: numFmt, t: 'n' };
  if (cell.f !== undefined) out.f = `=${cell.f}`;
  if (cell.note !== undefined) out.ps = { value: cell.note, isShow: false, left: null, top: null, width: null, height: null };
  if (style) {
    if (style.font) out.ff = style.font;
    if (style.size) out.fs = style.size;
    if (style.bold) out.bl = 1;
    if (style.italic) out.it = 1;
    if (style.underline) out.un = 1;
    if (style.strike) out.cl = 1;
    if (style.color) out.fc = style.color;
    if (style.fill) out.bg = style.fill;
    if (style.hAlign) out.ht = H_ALIGN[style.hAlign];
    if (style.wrap) out.tb = '2';
    if (style.rotation) out.rt = style.rotation;
  }
  // Excel aligns to the bottom unless told otherwise; FortuneSheet centers.
  out.vt = V_ALIGN[style?.vAlign ?? 'bottom'];
  return out;
}

function borderEntries(sheet: SheetType, styles: CellStyleType[]): unknown[] {
  const entries: unknown[] = [];
  for (const cell of sheet.cells) {
    const style = cell.s === undefined ? undefined : styles[cell.s];
    if (!style) continue;
    const value: Record<string, unknown> = { row_index: cell.r, col_index: cell.c };
    let any = false;
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const border = style[side];
      if (!border) continue;
      value[GRID_SIDE[side]] = { style: GRID_BORDER[border.style], color: border.color };
      any = true;
    }
    if (any) entries.push({ rangeType: 'cell', value });
  }
  return entries;
}

function frozenOf(frozen: SheetType['frozen']): GridSheet['frozen'] {
  if (frozen.rows > 0 && frozen.cols > 0) return { type: 'rangeBoth', range: { row_focus: frozen.rows - 1, column_focus: frozen.cols - 1 } };
  if (frozen.rows > 0) return { type: 'rangeRow', range: { row_focus: frozen.rows - 1, column_focus: 0 } };
  if (frozen.cols > 0) return { type: 'rangeColumn', range: { row_focus: 0, column_focus: frozen.cols - 1 } };
  return undefined;
}

const record = (entries: Array<[number, number]>): Record<string, number> => Object.fromEntries(entries.map(([k, v]) => [String(k), v]));

/** The sheets FortuneSheet opens for a model, each with a stable ID `sheet-<n>`; the active one has status 1. */
export function toGridSheets(workbook: WorkbookType, gridLimit: number): GridSheet[] {
  return workbook.sheets.map((sheet, index) => {
    const id = `sheet-${index + 1}`;
    const celldata: CellWithRowAndCol[] = sheet.cells.map((cell) => ({ r: cell.r, c: cell.c, v: gridCellOf(cell, cell.s === undefined ? undefined : workbook.styles[cell.s]) }));
    const at = new Map(celldata.map((d) => [`${d.r}_${d.c}`, d]));
    const merge: Record<string, { r: number; c: number; rs: number; cs: number }> = {};
    for (const m of sheet.merges) {
      merge[`${m.r}_${m.c}`] = { r: m.r, c: m.c, rs: m.rows, cs: m.cols };
      for (let r = m.r; r < m.r + m.rows; r += 1) {
        for (let c = m.c; c < m.c + m.cols; c += 1) {
          const key = `${r}_${c}`;
          const mc = r === m.r && c === m.c ? { r, c, rs: m.rows, cs: m.cols } : { r: m.r, c: m.c };
          const existing = at.get(key);
          if (existing) existing.v = { ...(r === m.r && c === m.c ? existing.v : {}), mc };
          else {
            const added = { r, c, v: { mc } };
            celldata.push(added);
            at.set(key, added);
          }
        }
      }
    }
    // Room to type past the content, within the grid limit.
    let rows = Math.max(sheet.rowCount + GRID_MARGIN.rows, GRID_MARGIN.minRows);
    let cols = Math.max(sheet.colCount + GRID_MARGIN.cols, GRID_MARGIN.minCols);
    if (rows * cols > gridLimit) rows = Math.max(sheet.rowCount, Math.floor(gridLimit / cols));
    if (rows * cols > gridLimit) cols = Math.max(sheet.colCount, Math.floor(gridLimit / rows));
    const formulas = sheet.cells.filter((c) => c.f !== undefined).map((c) => ({ r: c.r, c: c.c, id }));
    return {
      id,
      name: sheet.name,
      order: index,
      status: index === workbook.activeSheet ? 1 : 0,
      ...(sheet.hidden ? { hide: 1 } : {}),
      ...(sheet.tabColor ? { color: sheet.tabColor } : {}),
      row: rows,
      column: cols,
      celldata,
      calcChain: formulas,
      config: {
        merge,
        columnlen: record(sheet.colWidths.map((w) => [w.i, widthToPx(w.size)])),
        rowlen: record(sheet.rowHeights.map((h) => [h.i, heightToPx(h.size)])),
        colhidden: record(sheet.hiddenCols.map((c) => [c, 0])),
        rowhidden: record(sheet.hiddenRows.map((r) => [r, 0])),
        borderInfo: borderEntries(sheet, workbook.styles),
      },
      ...(frozenOf(sheet.frozen) ? { frozen: frozenOf(sheet.frozen) } : {}),
      ...(sheet.filter ? { filter_select: { row: [sheet.filter.r, sheet.filter.r + sheet.filter.rows - 1], column: [sheet.filter.c, sheet.filter.c + sheet.filter.cols - 1] } } : {}),
    } satisfies GridSheet;
  });
}

// Grid to model ---------------------------------------------------------------------------------------------------------

type CellBorders = Partial<Record<BorderSides, BorderSideType>>;

interface GridBorderLine {
  style?: number | string;
  color?: string;
}

function sideOf(line: GridBorderLine | undefined): BorderSideType | undefined {
  const style = MODEL_BORDER.get(Number(line?.style));
  return style ? { style, color: /^#[0-9a-f]{6}$/i.test(line?.color ?? '') ? line!.color!.toLowerCase() : '#000000' } : undefined;
}

/**
 * The borders of each cell from FortuneSheet's border list, applied in order: cell entries set sides, range entries
 * (from the toolbar) draw all, outside, inside, horizontal, vertical or one edge, or clear (`border-none`).
 */
export function cellBorders(borderInfo: unknown[] | undefined): Map<string, CellBorders> {
  const cells = new Map<string, CellBorders>();
  const set = (r: number, c: number, side: BorderSides, value: BorderSideType | undefined) => {
    const key = `${r}_${c}`;
    const entry = cells.get(key) ?? {};
    if (value) entry[side] = value;
    else delete entry[side];
    cells.set(key, entry);
  };
  for (const raw of borderInfo ?? []) {
    const entry = raw as { rangeType?: string; borderType?: string; style?: number | string; color?: string; range?: Array<{ row: number[]; column: number[] }>; value?: Record<string, unknown> };
    if (entry.rangeType === 'cell' && entry.value) {
      const { row_index: r, col_index: c } = entry.value as { row_index: number; col_index: number };
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const line = entry.value[GRID_SIDE[side]] as GridBorderLine | undefined;
        if (line !== undefined) set(r, c, side, sideOf(line));
      }
      continue;
    }
    if (entry.rangeType !== 'range' || !entry.range) continue;
    const line = sideOf({ style: entry.style, color: entry.color });
    for (const range of entry.range) {
      const [r1 = 0, r2 = r1] = range.row;
      const [c1 = 0, c2 = c1] = range.column;
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) {
          const edge = { top: r === r1, bottom: r === r2, left: c === c1, right: c === c2 };
          for (const side of ['top', 'right', 'bottom', 'left'] as const) {
            const inner = !edge[side];
            const draws: Record<string, boolean> = {
              'border-all': true,
              'border-outside': !inner,
              'border-inside': inner,
              'border-horizontal': inner && (side === 'top' || side === 'bottom'),
              'border-vertical': inner && (side === 'left' || side === 'right'),
              'border-top': side === 'top' && edge.top,
              'border-bottom': side === 'bottom' && edge.bottom,
              'border-left': side === 'left' && edge.left,
              'border-right': side === 'right' && edge.right,
            };
            if (entry.borderType === 'border-none') set(r, c, side, undefined);
            else if (draws[entry.borderType ?? '']) set(r, c, side, line);
          }
        }
      }
    }
  }
  return cells;
}

function valueOf(cell: GridCell): CellValueType | undefined {
  if (cell.ct?.t === 'inlineStr' && Array.isArray(cell.ct.s)) return (cell.ct.s as Array<{ v?: unknown }>).map((part) => String(part.v ?? '')).join('');
  const v = cell.v;
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  return String(v);
}

function styleOfGrid(cell: GridCell, borders: CellBorders | undefined): CellStyleType {
  const style: CellStyleType = {};
  const index = typeof cell.ff === 'number' ? cell.ff : typeof cell.ff === 'string' && /^\d+$/.test(cell.ff) ? Number(cell.ff) : null;
  const font = index !== null ? GRID_FONTS[index] : cell.ff;
  if (font && font !== GRID_DEFAULT_FONT) style.font = String(font).slice(0, 64);
  if (typeof cell.fs === 'number' && cell.fs >= 1) style.size = Math.min(409, cell.fs);
  if (Number(cell.bl) === 1) style.bold = true;
  if (Number(cell.it) === 1) style.italic = true;
  if (Number(cell.un) >= 1) style.underline = true;
  if (Number(cell.cl) === 1) style.strike = true;
  const hex = (c: string | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : undefined);
  const color = hex(cell.fc);
  if (color && color !== '#000000') style.color = color;
  const fill = hex(cell.bg);
  if (fill) style.fill = fill;
  const fa = cell.ct?.fa;
  if (fa && fa !== 'General' && fa.length <= 255) style.numFmt = fa;
  const h = Number(cell.ht);
  if (cell.ht !== undefined && h === 0) style.hAlign = 'center';
  else if (cell.ht !== undefined && h === 2) style.hAlign = 'right';
  else if (cell.ht !== undefined && h === 1) style.hAlign = 'left';
  const v = Number(cell.vt);
  if (cell.vt !== undefined && v === 0) style.vAlign = 'middle';
  else if (cell.vt !== undefined && v === 1) style.vAlign = 'top';
  if (String(cell.tb) === '2') style.wrap = true;
  const rotation = typeof cell.rt === 'number' && cell.rt !== 0 ? cell.rt : ROTATION_PRESETS[String(cell.tr)];
  if (rotation) style.rotation = Math.max(-90, Math.min(90, Math.round(rotation)));
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const border = borders?.[side];
    if (border) style[side] = border;
  }
  return style;
}

function sizes(record: Record<string, number> | undefined, convert: (px: number) => number): SizeType[] {
  return Object.entries(record ?? {})
    .map(([key, px]) => ({ i: Number(key), size: Math.min(409, convert(px)) }))
    .filter((s) => Number.isInteger(s.i) && s.i >= 0 && Number.isFinite(s.size))
    .sort((a, b) => a.i - b.i);
}

const indexes = (record: Record<string, number> | undefined): number[] =>
  Object.keys(record ?? {})
    .map(Number)
    .filter((i) => Number.isInteger(i) && i >= 0)
    .sort((a, b) => a - b);

function frozenFrom(frozen: GridSheet['frozen']): SheetType['frozen'] {
  const rf = (frozen?.range?.row_focus ?? 0) + 1;
  const cf = (frozen?.range?.column_focus ?? 0) + 1;
  switch (frozen?.type) {
    case 'row':
      return { rows: 1, cols: 0 };
    case 'column':
      return { rows: 0, cols: 1 };
    case 'both':
      return { rows: 1, cols: 1 };
    case 'rangeRow':
      return { rows: rf, cols: 0 };
    case 'rangeColumn':
      return { rows: 0, cols: cf };
    case 'rangeBoth':
      return { rows: rf, cols: cf };
    default:
      return { rows: 0, cols: 0 };
  }
}

/** One sheet's cells from FortuneSheet's matrix (`data`) or its sparse list (`celldata`). */
function gridCells(sheet: GridSheet): Array<{ r: number; c: number; cell: GridCell }> {
  if (sheet.data) {
    const out: Array<{ r: number; c: number; cell: GridCell }> = [];
    sheet.data.forEach((row, r) => row?.forEach((cell, c) => cell && out.push({ r, c, cell })));
    return out;
  }
  return (sheet.celldata ?? []).filter((d) => d.v).map((d) => ({ r: d.r, c: d.c, cell: d.v! }));
}

/** The model of FortuneSheet's sheets (in their tab order); styles are collected into one table. */
export function fromGridSheets(sheets: GridSheet[]): WorkbookType {
  const ordered = [...sheets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const styles: CellStyleType[] = [];
  const styleIds = new Map<string, number>();
  const styleId = (style: CellStyleType) => {
    const key = JSON.stringify(style);
    if (key === '{}') return undefined;
    let id = styleIds.get(key);
    if (id === undefined) {
      id = styles.push(style) - 1;
      styleIds.set(key, id);
    }
    return id;
  };
  const out = ordered.map((sheet): SheetType => {
    const config = sheet.config ?? {};
    const borders = cellBorders(config.borderInfo);
    const cells: CellType[] = [];
    let rows = 1;
    let cols = 1;
    const reach = (r: number, c: number) => {
      rows = Math.max(rows, r + 1);
      cols = Math.max(cols, c + 1);
    };
    const seen = new Set<string>();
    for (const { r, c, cell } of gridCells(sheet)) {
      const key = `${r}_${c}`;
      seen.add(key);
      const merged = cell.mc && (cell.mc.r !== r || cell.mc.c !== c);
      const v = merged ? undefined : valueOf(cell);
      const f = !merged && typeof cell.f === 'string' && cell.f.startsWith('=') && cell.f.length > 1 ? cell.f.slice(1) : undefined;
      const note = !merged && cell.ps?.value ? cell.ps.value : undefined;
      const style = styleOfGrid(cell, borders.get(key));
      const visible = v !== undefined || f !== undefined || note !== undefined || style.fill !== undefined || ['top', 'right', 'bottom', 'left'].some((s) => s in style);
      if (!visible) continue;
      const out: CellType = { r, c };
      if (v !== undefined) out.v = v;
      if (f !== undefined) out.f = f;
      const s = styleId(style);
      if (s !== undefined) out.s = s;
      if (note !== undefined) out.note = note;
      cells.push(out);
      reach(r, c);
    }
    // A border drawn on cells that hold nothing else.
    for (const [key, sides] of borders) {
      if (seen.has(key) || Object.keys(sides).length === 0) continue;
      const [r, c] = key.split('_').map(Number) as [number, number];
      cells.push({ r, c, s: styleId(styleOfGrid({}, sides))! });
      reach(r, c);
    }
    cells.sort((a, b) => a.r - b.r || a.c - b.c);
    const merges: CellRangeType[] = Object.values(config.merge ?? {}).map((m) => ({ r: m.r, c: m.c, rows: m.rs, cols: m.cs }));
    const select = sheet.filter_select;
    const filter = select?.row?.length === 2 && select.column?.length === 2 ? { r: select.row[0]!, c: select.column[0]!, rows: select.row[1]! - select.row[0]! + 1, cols: select.column[1]! - select.column[0]! + 1 } : null;
    const frozen = frozenFrom(sheet.frozen);
    for (const m of filter ? [...merges, filter] : merges) reach(m.r + m.rows - 1, m.c + m.cols - 1);
    if (frozen.rows > 0 || frozen.cols > 0) reach(Math.max(0, frozen.rows - 1), Math.max(0, frozen.cols - 1));
    const colWidths = sizes(config.columnlen, pxToWidth);
    const rowHeights = sizes(config.rowlen, pxToHeight);
    const hiddenCols = indexes(config.colhidden);
    const hiddenRows = indexes(config.rowhidden);
    for (const i of [...hiddenRows, ...rowHeights.map((h) => h.i)]) rows = Math.max(rows, i + 1);
    for (const i of [...hiddenCols, ...colWidths.map((w) => w.i)]) cols = Math.max(cols, i + 1);
    return {
      name: sheet.name,
      hidden: sheet.hide === 1,
      tabColor: sheet.color && /^#[0-9a-f]{6}$/i.test(sheet.color) ? sheet.color.toLowerCase() : null,
      rowCount: rows,
      colCount: cols,
      cells,
      merges,
      colWidths,
      rowHeights,
      hiddenRows,
      hiddenCols,
      frozen,
      filter,
    };
  });
  const active = ordered.findIndex((s) => s.status === 1);
  return { sheets: out, activeSheet: Math.max(0, active), styles };
}
