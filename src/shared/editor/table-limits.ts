/**
 * Size limits of a table (D-116). The editor's table map holds one entry per grid position (columns × rows), so a
 * small document with large spans could otherwise describe a grid of millions of cells and hang the editor. Main's
 * schema gate refuses such a document; the editor refuses a paste or an edit that would make one.
 */

/** Largest column or row span a cell may have. */
export const MAX_CELL_SPAN = 50;
/** Largest grid (columns × rows, spanned positions included) a table may have. */
export const MAX_TABLE_CELLS = 10_000;

export const TABLE_TOO_LARGE_MESSAGE = `This table is too large for a note (over ${MAX_TABLE_CELLS.toLocaleString('en-US')} cells or a cell spanning over ${MAX_CELL_SPAN} columns or rows). Use a smaller table.`;
export const TABLE_PASTED_AS_TEXT_MESSAGE = `This table is too large for a note (over ${MAX_TABLE_CELLS.toLocaleString('en-US')} cells), so it was pasted as text.`;

export interface CellSpan {
  colspan: number;
  rowspan: number;
}

/**
 * Whether a table fits the limits: every span within MAX_CELL_SPAN and its grid within MAX_TABLE_CELLS. The grid is
 * as wide as its widest row, counting the columns that cells spanning down from rows above take in it. The work is
 * bounded by the number of cells times MAX_CELL_SPAN, whatever the spans claim.
 */
export function tableFits(rows: ReadonlyArray<ReadonlyArray<CellSpan>>): boolean {
  const carried = new Array<number>(rows.length).fill(0);
  let columns = 0;
  for (let r = 0; r < rows.length; r += 1) {
    let width = carried[r]!;
    for (const { colspan, rowspan } of rows[r]!) {
      if (colspan > MAX_CELL_SPAN || rowspan > MAX_CELL_SPAN) return false;
      width += colspan;
      for (let below = r + 1; below < Math.min(rows.length, r + rowspan); below += 1) carried[below] = carried[below]! + colspan;
    }
    columns = Math.max(columns, width);
    if (columns * rows.length > MAX_TABLE_CELLS) return false;
  }
  return true;
}

/** Whether a grid of plain cells (pasted tab-separated text) fits the limits. */
export function gridFits(rowCount: number, columnCount: number): boolean {
  return rowCount * columnCount <= MAX_TABLE_CELLS;
}
