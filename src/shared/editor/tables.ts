import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';

/** Narrowest column a resize can leave, in CSS pixels. */
export const TABLE_CELL_MIN_WIDTH = 48;

/**
 * Tables in rich notes: rows of cells (`tableCell`, or `tableHeader` for a header row or column) that hold blocks.
 * Columns resize by dragging their edge (the widths are stored in the cells' `colwidth`); Tab and Shift+Tab move
 * between cells. Shared by the editor and main's live-sync schema.
 */
export const TABLE_EXTENSIONS = [Table.configure({ resizable: true, cellMinWidth: TABLE_CELL_MIN_WIDTH }), TableRow, TableHeader, TableCell];
