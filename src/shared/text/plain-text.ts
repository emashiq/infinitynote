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
]);
const MAX_DEPTH = 200;

interface PmNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

function endsWithNewline(out: string[]): boolean {
  const last = out[out.length - 1];
  return last === undefined || last.endsWith('\n');
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
  const isBlock = typeof n.type === 'string' && BLOCK_NODES.has(n.type);
  if (isBlock && !endsWithNewline(out)) out.push('\n');
  if (Array.isArray(n.content)) {
    for (const child of n.content) walk(child, depth + 1, out);
  }
  if (isBlock && !endsWithNewline(out)) out.push('\n');
}

export function extractPlainText(format: 'rich' | 'plain', content: unknown): string {
  if (format === 'plain') {
    return typeof content === 'string' ? content.replace(/\r\n/g, '\n') : '';
  }
  const out: string[] = [];
  walk(content, 0, out);
  return out.join('').replace(/\n+$/, '');
}
