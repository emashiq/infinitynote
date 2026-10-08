import type { Node as PmNode } from '@tiptap/pm/model';

export const MAX_FIND_MATCHES = 1000;
export const MAX_FIND_QUERY = 200;

export interface FindMatch {
  from: number;
  to: number;
}

// Inline nodes that are not text (hard breaks, atoms) occupy one position; this character keeps the offsets aligned
// and never matches a typed query.
const NON_TEXT = '￼';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Literal, case-insensitive, Unicode-aware matches of `query` in each text block (D-058), at most 1,000. A match
 * never spans two blocks.
 */
export function findMatches(doc: PmNode, query: string): FindMatch[] {
  if (query === '') return [];
  const pattern = new RegExp(escapeRegExp(query), 'giu');
  const matches: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (matches.length >= MAX_FIND_MATCHES) return false;
    if (!node.isTextblock) return true;
    let text = '';
    node.forEach((child) => {
      text += child.isText ? child.text! : NON_TEXT.repeat(child.nodeSize);
    });
    const start = pos + 1;
    for (const m of text.matchAll(pattern)) {
      if (matches.length >= MAX_FIND_MATCHES) break;
      matches.push({ from: start + m.index, to: start + m.index + m[0].length });
    }
    return false;
  });
  return matches;
}

/** The selected text to prefill the find field with: the first line, at most 200 characters. */
export function findPrefill(selected: string): string {
  return (selected.split(/\r?\n/)[0] ?? '').slice(0, MAX_FIND_QUERY);
}
