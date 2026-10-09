import { rowsToTsv } from './table-text';

const BLOCK_NODES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'taskItem',
  'bulletList',
  'orderedList',
  'taskList',
  'horizontalRule',
  'image',
  'fileAttachment',
  'fileLink',
]);
/** Blocks that hold text directly; each gives exactly one line, also when empty. */
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);
const MAX_DEPTH = 200;

interface PmNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  attrs?: { name?: unknown; label?: unknown } | null;
}

function endsWithNewline(out: string[]): boolean {
  const last = out[out.length - 1];
  return last === undefined || last.endsWith('\n');
}

const childNodes = (node: PmNode): PmNode[] => (Array.isArray(node.content) ? (node.content as PmNode[]) : []);

/** A cell's blocks on one line. */
function cellText(cell: PmNode, depth: number): string {
  const out: string[] = [];
  for (const child of childNodes(cell)) walk(child, depth + 1, out);
  return out.join('').trim().replace(/\n+/g, ' ');
}

function walk(node: unknown, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return;
  const n = node as PmNode;
  if (n.type === 'text') {
    if (typeof n.text === 'string') out.push(n.text);
    return;
  }
  if (n.type === 'hardBreak') {
    out.push('\n');
    return;
  }
  // A note reference reads as the title it showed when inserted (search and conversion keep it as text).
  if (n.type === 'noteRef') {
    if (typeof n.attrs?.label === 'string') out.push(n.attrs.label);
    return;
  }
  // A table reads as one line per row with tab-separated cells, as spreadsheets copy it.
  if (n.type === 'table') {
    if (!endsWithNewline(out)) out.push('\n');
    out.push(`${rowsToTsv(childNodes(n).map((row) => childNodes(row).map((cell) => cellText(cell, depth + 2))))}\n`);
    return;
  }
  const isBlock = typeof n.type === 'string' && BLOCK_NODES.has(n.type);
  if (isBlock && !endsWithNewline(out)) out.push('\n');
  const start = out.length;
  // A file chip (copied or linked) contributes its name as its own line; images contribute no text.
  if ((n.type === 'fileAttachment' || n.type === 'fileLink') && typeof n.attrs?.name === 'string') out.push(n.attrs.name);
  if (Array.isArray(n.content)) {
    for (const child of n.content) walk(child, depth + 1, out);
  }
  if (isBlock && !endsWithNewline(out)) out.push('\n');
  else if (TEXT_BLOCKS.has(n.type as string) && out.length === start) out.push('\n');
}

/**
 * The text of a note, used for search, previews and rich-to-plain conversion: plain notes as stored (LF line
 * ends), rich notes one line per text block (empty paragraphs give empty lines; trailing ones are dropped) and one
 * line per table row with tab-separated cells.
 */
export function extractPlainText(format: 'rich' | 'plain', content: unknown): string {
  if (format === 'plain') {
    return typeof content === 'string' ? content.replace(/\r\n/g, '\n') : '';
  }
  const out: string[] = [];
  walk(content, 0, out);
  return out.join('').replace(/\n+$/, '');
}
