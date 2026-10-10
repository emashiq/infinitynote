import ExcelJS from 'exceljs';
import type { BorderSideType, CellStyleType, CellType, WorkbookType } from '../../../shared/documents/workbook';
import { argbOf } from './excel-colors';

/** Excel's default row height in points (Calibri 11). */
const DEFAULT_ROW_HEIGHT = 15;

/**
 * The workbook model as a new xlsx package (F3, D-134), written with ExcelJS in the workbook worker. Everything the
 * model carries is written; what it does not carry was listed to the user before the first save (D-136).
 */
export async function writeXlsx(model: WorkbookType): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const styles = model.styles.map(excelStyleOf);
  model.sheets.forEach((sheet, index) => {
    const frozen = sheet.frozen.rows > 0 || sheet.frozen.cols > 0;
    const ws = wb.addWorksheet(sheet.name, {
      // The active sheet is always shown, as Excel requires.
      state: sheet.hidden && index !== model.activeSheet ? 'hidden' : 'visible',
      properties: sheet.tabColor ? { tabColor: argbOf(sheet.tabColor) } : {},
      views: frozen ? [{ state: 'frozen', xSplit: sheet.frozen.cols, ySplit: sheet.frozen.rows }] : [],
    });
    for (const { i, size } of sheet.colWidths) ws.getColumn(i + 1).width = size;
    for (const c of sheet.hiddenCols) ws.getColumn(c + 1).hidden = true;
    for (const { i, size } of sheet.rowHeights) ws.getRow(i + 1).height = size;
    for (const r of sheet.hiddenRows) {
      const row = ws.getRow(r + 1);
      row.hidden = true;
      // ExcelJS leaves out rows with neither cells nor a height, which would lose an empty hidden row.
      row.height ??= DEFAULT_ROW_HEIGHT;
    }
    for (const cell of sheet.cells) writeCell(ws.getCell(cell.r + 1, cell.c + 1), cell, styles);
    for (const m of sheet.merges) ws.mergeCells(m.r + 1, m.c + 1, m.r + m.rows, m.c + m.cols);
    if (sheet.filter) {
      const f = sheet.filter;
      ws.autoFilter = { from: { row: f.r + 1, column: f.c + 1 }, to: { row: f.r + f.rows, column: f.c + f.cols } };
    }
  });
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: model.activeSheet, visibility: 'visible' }];
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function writeCell(target: ExcelJS.Cell, cell: CellType, styles: Array<Partial<ExcelJS.Style>>): void {
  if (cell.f !== undefined) target.value = cell.v === undefined ? { formula: cell.f } : { formula: cell.f, result: cell.v };
  else if (cell.v !== undefined) target.value = cell.v;
  if (cell.s !== undefined) target.style = styles[cell.s]!;
  if (cell.note !== undefined) target.note = cell.note;
}

function borderOf(side: BorderSideType | undefined): Partial<ExcelJS.Border> | undefined {
  return side ? { style: side.style, color: argbOf(side.color) } : undefined;
}

/** The ExcelJS style of a model style. */
export function excelStyleOf(style: CellStyleType): Partial<ExcelJS.Style> {
  const out: Partial<ExcelJS.Style> = {};
  const font: Partial<ExcelJS.Font> = {};
  if (style.font) font.name = style.font;
  if (style.size) font.size = style.size;
  if (style.bold) font.bold = true;
  if (style.italic) font.italic = true;
  if (style.underline) font.underline = true;
  if (style.strike) font.strike = true;
  if (style.color) font.color = argbOf(style.color);
  if (Object.keys(font).length > 0) out.font = font;
  if (style.fill) out.fill = { type: 'pattern', pattern: 'solid', fgColor: argbOf(style.fill) };
  if (style.numFmt) out.numFmt = style.numFmt;
  const alignment: Partial<ExcelJS.Alignment> = {};
  if (style.hAlign) alignment.horizontal = style.hAlign;
  if (style.vAlign) alignment.vertical = style.vAlign;
  if (style.wrap) alignment.wrapText = true;
  if (style.rotation) alignment.textRotation = style.rotation;
  if (Object.keys(alignment).length > 0) out.alignment = alignment;
  const border: Partial<ExcelJS.Borders> = {};
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const b = borderOf(style[side]);
    if (b) border[side] = b;
  }
  if (Object.keys(border).length > 0) out.border = border;
  return out;
}
