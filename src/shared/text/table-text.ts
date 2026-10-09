/**
 * Tables as tab-separated text, the form spreadsheets put on the clipboard: one line per row, cells separated by tabs.
 * Plain text of notes (search, previews, conversion) and the clipboard use the same form.
 */

/** Rows of cell texts as tab-separated lines; a tab or line break inside a cell becomes a space. */
export function rowsToTsv(rows: ReadonlyArray<readonly string[]>): string {
  return rows.map((cells) => cells.map((cell) => cell.replace(/[\t\r\n]+/g, ' ').trim()).join('\t')).join('\n');
}

/** Splits tab-separated text into rows of fields; a field in double quotes may hold tabs, line breaks and `""`. */
function parseFields(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  while (i < text.length) {
    if (field === '' && text[i] === '"') {
      const end = closingQuote(text, i + 1);
      if (end >= 0) {
        field = text.slice(i + 1, end).replace(/""/g, '"');
        i = end + 1;
        continue;
      }
    }
    const ch = text[i]!;
    if (ch === '\t') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
    } else {
      field += ch;
    }
    i += 1;
  }
  if (field !== '' || row.length > 0) rows.push([...row, field]);
  return rows;
}

/** The index of the quote that closes a quoted field starting at `from`, when a tab, line end or the end follows it. */
function closingQuote(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] !== '"') continue;
    if (text[i + 1] === '"') {
      i += 1;
      continue;
    }
    const next = text[i + 1];
    return next === undefined || next === '\t' || next === '\n' || next === '\r' ? i : -1;
  }
  return -1;
}

/**
 * The rows of a pasted text that reads as a table: at least two rows and two columns, every row with the same number
 * of cells and no column entirely empty (so tab-indented lines stay text). Null for any other text.
 */
export function tsvToRows(text: string): string[][] | null {
  if (!text.includes('\t')) return null;
  const rows = parseFields(text);
  const width = rows[0]?.length ?? 0;
  if (rows.length < 2 || width < 2 || rows.some((r) => r.length !== width)) return null;
  for (let col = 0; col < width; col += 1) {
    if (rows.every((r) => r[col]!.trim() === '')) return null;
  }
  return rows;
}
