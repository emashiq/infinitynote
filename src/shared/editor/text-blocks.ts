import { UUID_RE } from '../contracts/ids';
import { MAX_DOC_DEPTH } from './doc-schema';
import { inlineAtomText } from './inline-text';

export type TextBlockKind = 'paragraph' | 'heading' | 'codeBlock';

export interface StoredTextBlock {
  id: string;
  kind: TextBlockKind;
  /** The block's text for display: text in order, a link as what it shows, math as TeX, a line break as a space. */
  text: string;
}

const KINDS = new Set<string>(['paragraph', 'heading', 'codeBlock']);

interface JsonNode {
  type?: unknown;
  text?: unknown;
  attrs?: { id?: unknown } | null;
  content?: unknown;
}

function displayText(block: JsonNode): string {
  if (!Array.isArray(block.content)) return '';
  let out = '';
  for (const child of block.content as JsonNode[]) {
    if (child?.type === 'text' && typeof child.text === 'string') out += child.text;
    else if (child?.type === 'hardBreak') out += ' ';
    else out += inlineAtomText(child ?? {}) ?? '';
  }
  return out;
}

/** Every textblock with a block ID in a stored rich document, in document order (containers are walked into). */
export function textBlocksOf(doc: unknown): StoredTextBlock[] {
  const out: StoredTextBlock[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== 'object' || depth > MAX_DOC_DEPTH) return;
    const n = node as JsonNode;
    if (typeof n.type === 'string' && KINDS.has(n.type)) {
      const id = n.attrs?.id;
      if (typeof id === 'string' && UUID_RE.test(id)) out.push({ id, kind: n.type as TextBlockKind, text: displayText(n) });
      return;
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child, depth + 1);
  };
  walk(doc, 0);
  return out;
}

/** Text cut to `max` characters with an ellipsis, on one line. */
export function clipText(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}
