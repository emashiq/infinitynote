import { getTextBetween, getTextSerializersFromSchema, type TextSerializer } from '@tiptap/core';
import { Fragment, Slice, type Node as PmNode, type Schema } from '@tiptap/pm/model';
import { gridFits } from '../../shared/editor/table-limits';
import { rowsToTsv, tsvToRows } from '../../shared/text/table-text';

const isRow = (node: PmNode) => node.type.spec.tableRole === 'row';

type TextSerializers = Record<string, TextSerializer>;

/** The text of a node's content as the editor copies it (note references read as their label). */
const textOf = (node: PmNode, textSerializers: TextSerializers, blockSeparator: string) =>
  getTextBetween(node, { from: 0, to: node.content.size }, { blockSeparator, textSerializers });

/** Table rows as tab-separated lines; a cell's blocks go on one line. */
function rowsTsv(rows: readonly PmNode[], textSerializers: TextSerializers): string {
  return rowsToTsv(
    rows.map((row) => {
      const cells: string[] = [];
      row.forEach((cell) => cells.push(textOf(cell, textSerializers, ' ')));
      return cells;
    }),
  );
}

/**
 * The plain text put on the clipboard next to the HTML when a copy holds a table or cells of one (a cell selection
 * copies rows): each table as tab-separated lines, which spreadsheets paste as cells, and other blocks as text. Null
 * for a copy without table content, which keeps the editor's usual text.
 */
export function tableClipboardText(slice: Slice, schema: Schema): string | null {
  const nodes: PmNode[] = [];
  slice.content.forEach((node) => nodes.push(node));
  if (!nodes.some((n) => n.type.name === 'table' || isRow(n))) return null;
  const textSerializers = getTextSerializersFromSchema(schema);
  const parts: string[] = [];
  let rows: PmNode[] = [];
  const flushRows = () => {
    if (rows.length > 0) parts.push(rowsTsv(rows, textSerializers));
    rows = [];
  };
  for (const node of nodes) {
    if (isRow(node)) {
      rows.push(node);
      continue;
    }
    flushRows();
    if (node.type.name === 'table') {
      const tableRows: PmNode[] = [];
      node.forEach((row) => tableRows.push(row));
      parts.push(rowsTsv(tableRows, textSerializers));
    } else {
      parts.push(node.isText ? (node.text ?? '') : textOf(node, textSerializers, '\n\n'));
    }
  }
  flushRows();
  return parts.join('\n\n');
}

/**
 * Tab-separated text with several rows and columns (tsvToRows) as a slice holding one table; null for other text and
 * for a table over the table limits (D-116), which stays text after `tooLarge` is called.
 */
export function tableSliceFromText(text: string, schema: Schema, tooLarge: () => void): Slice | null {
  const rows = tsvToRows(text);
  const { table, tableRow, tableCell, paragraph } = schema.nodes;
  if (!rows || !table || !tableRow || !tableCell || !paragraph) return null;
  if (!gridFits(rows.length, rows[0]!.length)) {
    tooLarge();
    return null;
  }
  const node = table.create(
    null,
    rows.map((cells) => tableRow.create(null, cells.map((cell) => tableCell.create(null, paragraph.create(null, cell === '' ? null : schema.text(cell)))))),
  );
  return new Slice(Fragment.from(node), 0, 0);
}
