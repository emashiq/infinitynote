import type { Fragment, Node as PmNode } from '@tiptap/pm/model';
import { tableFits, type CellSpan } from '../../shared/editor/table-limits';

const isTable = (node: PmNode) => node.type.spec.tableRole === 'table';
const isRow = (node: PmNode) => node.type.spec.tableRole === 'row';

function spansOf(rows: readonly PmNode[]): CellSpan[][] {
  return rows.map((row) => {
    const cells: CellSpan[] = [];
    row.forEach((cell) => cells.push({ colspan: cell.attrs.colspan as number, rowspan: cell.attrs.rowspan as number }));
    return cells;
  });
}

/** Whether a table node fits the table limits (D-116). */
export function tableNodeFits(table: PmNode): boolean {
  const rows: PmNode[] = [];
  table.forEach((row) => rows.push(row));
  return tableFits(spansOf(rows));
}

/**
 * Whether every table in pasted content fits the table limits: tables at any depth, and bare rows at the top (a copied
 * cell selection), which paste as one table.
 */
export function fragmentTablesFit(fragment: Fragment): boolean {
  const rows: PmNode[] = [];
  fragment.forEach((node) => {
    if (isRow(node)) rows.push(node);
  });
  if (rows.length > 0 && !tableFits(spansOf(rows))) return false;
  let fits = true;
  fragment.descendants((node) => {
    if (fits && isTable(node)) fits = tableNodeFits(node);
    return fits;
  });
  return fits;
}

/** Whether every table overlapping [from, to] of a document fits the table limits (tables nest inside cells). */
export function tablesAroundFit(doc: PmNode, from: number, to: number): boolean {
  let fits = true;
  doc.nodesBetween(from, to, (node) => {
    if (fits && isTable(node)) fits = tableNodeFits(node);
    return fits;
  });
  return fits;
}
