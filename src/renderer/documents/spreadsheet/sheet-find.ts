import type { Cell as GridCell, Sheet as GridSheet } from '@fortune-sheet/core';

/** One cell that matches a search, in a sheet by its grid ID. */
export interface SheetMatch {
  sheetId: string;
  r: number;
  c: number;
}

export interface SheetFindOptions {
  caseSensitive: boolean;
  /** The whole shown text of the cell must equal the query. */
  wholeCell: boolean;
}

/** The text a cell shows (its formatted value), which is what find compares. */
function shownText(cell: GridCell | null | undefined): string {
  if (!cell || (cell.mc && cell.mc.rs === undefined)) return '';
  if (cell.ct?.t === 'inlineStr' && Array.isArray(cell.ct.s)) return (cell.ct.s as Array<{ v?: unknown }>).map((part) => String(part.v ?? '')).join('');
  const shown = cell.m ?? cell.v;
  return shown === undefined || shown === null ? '' : String(shown);
}

/**
 * Cells whose shown text contains (or equals) the query, sheet by sheet in tab order, row by row. Hidden sheets are
 * left out, since the grid cannot show them.
 */
export function findInSheets(sheets: GridSheet[], query: string, options: SheetFindOptions): SheetMatch[] {
  if (query === '') return [];
  const fold = (text: string) => (options.caseSensitive ? text : text.toLocaleLowerCase());
  const wanted = fold(query);
  const matches: SheetMatch[] = [];
  for (const sheet of [...sheets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (sheet.hide === 1 || !sheet.id) continue;
    const cells = sheet.data
      ? sheet.data.flatMap((row, r) => (row ?? []).map((cell, c) => ({ r, c, cell })))
      : (sheet.celldata ?? []).map((d) => ({ r: d.r, c: d.c, cell: d.v })).sort((a, b) => a.r - b.r || a.c - b.c);
    for (const { r, c, cell } of cells) {
      const text = fold(shownText(cell));
      if (text !== '' && (options.wholeCell ? text === wanted : text.includes(wanted))) matches.push({ sheetId: sheet.id, r, c });
    }
  }
  return matches;
}

/** The match after (or before) the current one, going round at either end; -1 when there are none. */
export function stepMatch(count: number, current: number, previous: boolean): number {
  if (count === 0) return -1;
  if (current < 0) return previous ? count - 1 : 0;
  return (current + (previous ? count - 1 : 1)) % count;
}
