/**
 * The text of the app's inline atoms wherever a document is read as text (search, previews, conversion, the picker's
 * block list, Markdown): a link reads as what it shows (its alias, else the title it had when made, D-156) and inline
 * math as its TeX source (D-161).
 */

interface AtomLike {
  type?: unknown;
  attrs?: unknown;
}

const stringAttr = (attrs: unknown, name: string): string | null => {
  if (attrs === null || typeof attrs !== 'object') return null;
  const v = (attrs as Record<string, unknown>)[name];
  return typeof v === 'string' ? v : null;
};

/** What a note or document link shows: its alias, else its label. */
export function refText(attrs: unknown): string {
  return stringAttr(attrs, 'alias') || (stringAttr(attrs, 'label') ?? '');
}

/** The text of an inline atom node, or null when the node is not one. */
export function inlineAtomText(node: AtomLike): string | null {
  if (node.type === 'noteRef' || node.type === 'docRef') return refText(node.attrs);
  if (node.type === 'mathInline') return stringAttr(node.attrs, 'latex') ?? '';
  return null;
}
