import { z } from 'zod';

/**
 * The workbook model spreadsheets travel in (F3, D-134): what main reads from an xlsx or csv file, what the grid shows
 * and edits, and what main writes back. It carries values, formulas, cell styles, merges, sizes, hidden rows and
 * columns, frozen panes, filters and notes; anything else in a file is listed as simplified before it is first saved.
 * Every size is bounded, both when main reads a file and on IPC.
 */
export const WORKBOOK_LIMITS = {
  maxSheets: 64,
  /** Excel's own grid. */
  maxRows: 1_048_576,
  maxCols: 16_384,
  /** Rows x columns of one sheet: the grid keeps a full matrix per sheet. */
  maxGridCells: 2_000_000,
  /** Cells with a value, formula, style or note, in all sheets. */
  maxCells: 500_000,
  /** Excel's limit for the text of one cell. */
  maxTextChars: 32_767,
  maxFormulaChars: 8_192,
  maxNoteChars: 32_767,
  maxStyles: 64_000,
  maxMerges: 100_000,
  maxSheetNameChars: 31,
  maxFontNameChars: 64,
  maxNumFmtChars: 255,
} as const;

/** Files larger than this are not opened in the spreadsheet editor (the store limit, D-118). */
export const MAX_WORKBOOK_FILE_MB = 25;

export const Color = z.string().regex(/^#[0-9a-f]{6}$/);

export const BORDER_STYLES = [
  'thin',
  'medium',
  'thick',
  'dashed',
  'dotted',
  'double',
  'hair',
  'mediumDashed',
  'dashDot',
  'mediumDashDot',
  'dashDotDot',
  'mediumDashDotDot',
  'slantDashDot',
] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

export const BorderSide = z.strictObject({ style: z.enum(BORDER_STYLES), color: Color });
export type BorderSideType = z.infer<typeof BorderSide>;

export const CellStyle = z.strictObject({
  font: z.string().min(1).max(WORKBOOK_LIMITS.maxFontNameChars).optional(),
  /** Points. */
  size: z.number().min(1).max(409).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  color: Color.optional(),
  fill: Color.optional(),
  numFmt: z.string().min(1).max(WORKBOOK_LIMITS.maxNumFmtChars).optional(),
  hAlign: z.enum(['left', 'center', 'right']).optional(),
  vAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  wrap: z.boolean().optional(),
  /** Degrees, counter-clockwise; Excel's range. */
  rotation: z.number().int().min(-90).max(90).optional(),
  top: BorderSide.optional(),
  right: BorderSide.optional(),
  bottom: BorderSide.optional(),
  left: BorderSide.optional(),
});
export type CellStyleType = z.infer<typeof CellStyle>;

const Row = z.number().int().min(0).max(WORKBOOK_LIMITS.maxRows - 1);
const Col = z.number().int().min(0).max(WORKBOOK_LIMITS.maxCols - 1);

export const CellValue = z.union([z.string().max(WORKBOOK_LIMITS.maxTextChars), z.number().finite(), z.boolean()]);
export type CellValueType = z.infer<typeof CellValue>;

/** One cell, zero-based. `f` is a formula without its leading `=`, `v` its last result; `s` indexes the styles. */
export const Cell = z.strictObject({
  r: Row,
  c: Col,
  v: CellValue.optional(),
  f: z.string().min(1).max(WORKBOOK_LIMITS.maxFormulaChars).optional(),
  s: z.number().int().min(0).max(WORKBOOK_LIMITS.maxStyles - 1).optional(),
  note: z.string().min(1).max(WORKBOOK_LIMITS.maxNoteChars).optional(),
});
export type CellType = z.infer<typeof Cell>;

/** A block of cells from (r, c), `rows` x `cols`: a merge or a filter range. */
export const CellRange = z.strictObject({ r: Row, c: Col, rows: z.number().int().min(1), cols: z.number().int().min(1) });
export type CellRangeType = z.infer<typeof CellRange>;

/** Column widths in characters and row heights in points, as Excel keeps them. */
const Size = z.strictObject({ i: z.number().int().min(0), size: z.number().min(0).max(409) });
export type SizeType = z.infer<typeof Size>;

/** Excel's forbidden sheet name characters. */
const SHEET_NAME_RE = /^[^\\/?*[\]:]+$/;

export const Sheet = z.strictObject({
  name: z.string().min(1).max(WORKBOOK_LIMITS.maxSheetNameChars).regex(SHEET_NAME_RE).refine((n) => !n.startsWith("'") && !n.endsWith("'")),
  hidden: z.boolean(),
  tabColor: Color.nullable(),
  /** The extent of the sheet in use; the grid shows at least this many rows and columns. */
  rowCount: z.number().int().min(1).max(WORKBOOK_LIMITS.maxRows),
  colCount: z.number().int().min(1).max(WORKBOOK_LIMITS.maxCols),
  cells: z.array(Cell),
  merges: z.array(CellRange).max(WORKBOOK_LIMITS.maxMerges),
  colWidths: z.array(Size).max(WORKBOOK_LIMITS.maxCols),
  rowHeights: z.array(Size).max(WORKBOOK_LIMITS.maxRows),
  hiddenRows: z.array(Row).max(WORKBOOK_LIMITS.maxRows),
  hiddenCols: z.array(Col).max(WORKBOOK_LIMITS.maxCols),
  /** Rows above and columns left of the panes that stay in place; 0 for none. */
  frozen: z.strictObject({ rows: z.number().int().min(0).max(WORKBOOK_LIMITS.maxRows), cols: z.number().int().min(0).max(WORKBOOK_LIMITS.maxCols) }),
  filter: CellRange.nullable(),
});
export type SheetType = z.infer<typeof Sheet>;

export const Workbook = z
  .strictObject({
    sheets: z.array(Sheet).min(1).max(WORKBOOK_LIMITS.maxSheets),
    activeSheet: z.number().int().min(0),
    styles: z.array(CellStyle).max(WORKBOOK_LIMITS.maxStyles),
  })
  .superRefine((wb, ctx) => {
    const problem = workbookProblem(wb);
    if (problem) ctx.addIssue({ code: 'custom', message: problem.message, path: problem.path });
  });
export type WorkbookType = z.infer<typeof Workbook>;

/**
 * What the field checks cannot see: sizes across the workbook (grid area, cell count), cells and ranges inside their
 * sheet, style indexes, and sheet names unique without regard to case, as Excel requires.
 */
function workbookProblem(wb: { sheets: SheetType[]; activeSheet: number; styles: unknown[] }): { message: string; path: Array<string | number> } | null {
  if (wb.activeSheet >= wb.sheets.length) return { message: 'No such sheet', path: ['activeSheet'] };
  const names = new Set<string>();
  let cells = 0;
  for (const [i, sheet] of wb.sheets.entries()) {
    const at = (field: string) => ['sheets', i, field];
    const name = sheet.name.toLowerCase();
    if (names.has(name)) return { message: 'Sheet names must differ', path: at('name') };
    names.add(name);
    if (sheet.rowCount * sheet.colCount > WORKBOOK_LIMITS.maxGridCells) return { message: 'Sheet too large', path: at('rowCount') };
    cells += sheet.cells.length;
    if (cells > WORKBOOK_LIMITS.maxCells) return { message: 'Too many cells', path: at('cells') };
    const inside = (r: number, c: number) => r < sheet.rowCount && c < sheet.colCount;
    if (!sheet.cells.every((cell) => inside(cell.r, cell.c) && (cell.s === undefined || cell.s < wb.styles.length))) return { message: 'Cell outside its sheet', path: at('cells') };
    const ranges = sheet.filter ? [...sheet.merges, sheet.filter] : sheet.merges;
    if (!ranges.every((m) => inside(m.r + m.rows - 1, m.c + m.cols - 1))) return { message: 'Range outside its sheet', path: at('merges') };
  }
  return null;
}

/** How a CSV or TSV file is written back: the separator and the text encoding it was read with (D-135). */
export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;
export const CSV_ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252'] as const;
export const CsvFormat = z.strictObject({
  delimiter: z.enum(CSV_DELIMITERS),
  encoding: z.enum(CSV_ENCODINGS),
  bom: z.boolean(),
  lineEnding: z.enum(['\r\n', '\n']),
  /** Whether the last row ended with a line break. */
  finalNewline: z.boolean(),
});
export type CsvFormatType = z.infer<typeof CsvFormat>;

/** Parts of a workbook the model does not carry, named as the "Simplified on save" notice lists them (D-136). */
export const WORKBOOK_FEATURES = [
  'charts',
  'pivotTables',
  'images',
  'conditionalFormatting',
  'dataValidation',
  'tables',
  'namedRanges',
  'hyperlinks',
  'richText',
  'arrayFormulas',
  'protection',
  'externalLinks',
  'formControls',
  'slicers',
  'printSettings',
] as const;
export type WorkbookFeature = (typeof WORKBOOK_FEATURES)[number];

export const WORKBOOK_FEATURE_LABELS: Record<WorkbookFeature, string> = {
  charts: 'Charts',
  pivotTables: 'Pivot tables',
  images: 'Pictures and shapes',
  conditionalFormatting: 'Conditional formatting',
  dataValidation: 'Data validation (drop-down lists and input rules)',
  tables: 'Excel tables (formatted as table)',
  namedRanges: 'Named ranges',
  hyperlinks: 'Links in cells (the text stays)',
  richText: 'Mixed formatting inside one cell (the text stays)',
  arrayFormulas: 'Array formulas (their last values stay)',
  protection: 'Sheet and workbook protection',
  externalLinks: 'Links to other workbooks',
  formControls: 'Form controls and ActiveX controls',
  slicers: 'Slicers and timelines',
  printSettings: 'Page setup, headers and footers for printing',
};
