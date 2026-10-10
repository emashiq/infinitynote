import { Fragment, Slice, type Node as PmNode, type Schema } from '@tiptap/pm/model';

/** A fence line: up to three spaces, three or more backticks or tildes, and an optional language word. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([A-Za-z][\w+#-]{0,31})?[ \t]*$/;

/** True when the text holds at least one complete fenced code block (an opening and a closing fence line). */
export function hasCodeFence(text: string): boolean {
  return blocksOf(text).some((b) => b.kind === 'code');
}

type TextBlock = { kind: 'line'; text: string } | { kind: 'code'; language: string | null; text: string };

function blocksOf(text: string): TextBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: TextBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = FENCE_OPEN.exec(lines[i]!);
    const marker = open?.[1];
    const close = marker ? lines.findIndex((line, j) => j > i && new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`).test(line)) : -1;
    if (!open || close < 0) {
      blocks.push({ kind: 'line', text: lines[i]! });
      continue;
    }
    blocks.push({ kind: 'code', language: open[2]?.toLowerCase() ?? null, text: lines.slice(i + 1, close).join('\n') });
    i = close;
  }
  return blocks;
}

/**
 * Pasted plain text with Markdown code fences (D-183): every complete fence becomes a code block of its language (so a
 * "```mermaid" fence becomes a diagram) and the other non-empty lines become paragraphs, as ProseMirror pastes text.
 * Null when there is no complete fence, so ordinary text pastes as before. The slice is open at a paragraph on either
 * end, so the first and last lines join the paragraph the cursor is in.
 */
export function fencedTextSlice(text: string, schema: Schema): Slice | null {
  const blocks = blocksOf(text);
  if (!blocks.some((b) => b.kind === 'code')) return null;
  const { paragraph, codeBlock } = schema.nodes;
  if (!paragraph || !codeBlock) return null;
  const nodes: PmNode[] = [];
  for (const block of blocks) {
    if (block.kind === 'code') nodes.push(codeBlock.create({ language: block.language }, block.text === '' ? null : schema.text(block.text)));
    else if (block.text.trim() !== '') nodes.push(paragraph.create(null, schema.text(block.text)));
  }
  const open = (node: PmNode | undefined) => (node?.type === paragraph ? 1 : 0);
  return new Slice(Fragment.from(nodes), open(nodes[0]), open(nodes.at(-1)));
}
