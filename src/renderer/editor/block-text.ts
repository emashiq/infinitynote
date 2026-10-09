import type { Node as PmNode } from '@tiptap/pm/model';

/**
 * The text of one textblock as main reads it from the stored JSON (`richBlockText`: text in order, a hard break as
 * "\n"), with the document position of every character, so phrase offsets and editor positions convert both ways.
 */
export interface BlockText {
  text: string;
  /** The document position before character `offset` (`text.length` gives the end of the content). */
  posAt(offset: number): number;
  /** The character offset at a document position inside the block (clamped to the block). */
  offsetAt(pos: number): number;
}

/** `node` is a textblock and `contentStart` the position right inside it (its position + 1). */
export function textOfBlock(node: PmNode, contentStart: number): BlockText {
  let text = '';
  const positions: number[] = [];
  node.forEach((child, offset) => {
    const pos = contentStart + offset;
    if (child.isText) {
      for (let i = 0; i < child.text!.length; i += 1) positions.push(pos + i);
      text += child.text!;
    } else if (child.type.name === 'hardBreak') {
      positions.push(pos);
      text += '\n';
    }
  });
  const end = contentStart + node.content.size;
  return {
    text,
    posAt: (offset) => (offset >= positions.length ? end : positions[Math.max(0, offset)]!),
    offsetAt: (pos) => {
      let lo = 0;
      let hi = positions.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (positions[mid]! < pos) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
  };
}

/** A textblock of the document with its block ID (rich notes) or its line index (plain notes). */
export interface TextBlockRef {
  node: PmNode;
  pos: number;
  /** The block ID of a rich textblock; null in plain-text notes and for blocks without one. */
  blockId: string | null;
  /** The paragraph's index in a plain-text note (its line); -1 in rich notes. */
  line: number;
  /** In a plain-text note, the offset of this line in the whole text (lines joined by "\n"). */
  lineStart: number;
}

/**
 * Every textblock in document order. Plain notes are a list of paragraphs (one per line); rich textblocks keep their
 * own IDs (paragraphs inside list items and quotes carry their own). Code blocks are listed too; callers skip them.
 */
export function textBlocks(doc: PmNode, format: 'rich' | 'plain'): TextBlockRef[] {
  const blocks: TextBlockRef[] = [];
  if (format === 'plain') {
    let lineStart = 0;
    doc.forEach((node, pos, index) => {
      blocks.push({ node, pos, blockId: null, line: index, lineStart });
      lineStart += node.textContent.length + 1;
    });
    return blocks;
  }
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    blocks.push({ node, pos, blockId: typeof node.attrs.id === 'string' ? node.attrs.id : null, line: -1, lineStart: 0 });
    return false;
  });
  return blocks;
}

/** The textblock around a document position, or null (an image or the gap between blocks). */
export function textBlockAt(doc: PmNode, format: 'rich' | 'plain', pos: number): TextBlockRef | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if (!$pos.parent.isTextblock) return null;
  const blockPos = $pos.before($pos.depth);
  return textBlocks(doc, format).find((b) => b.pos === blockPos) ?? null;
}
