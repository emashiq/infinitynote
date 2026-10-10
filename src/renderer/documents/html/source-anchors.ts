/**
 * Text positions in the HTML viewer's Source view (D-165): comments on a web page are anchored by the quoted source text
 * and which occurrence of it was selected, since the page itself is in a sandboxed frame the app cannot read.
 */

function textNodes(root: Node): Text[] {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** The offset in `root`'s text of a DOM position inside it. */
export function textOffset(root: Node, node: Node, offset: number): number {
  const range = root.ownerDocument!.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** A DOM range over `root`'s text from `start` to `end`, or null when the text is shorter. */
export function rangeOf(root: Node, start: number, end: number): Range | null {
  const range = root.ownerDocument!.createRange();
  let total = 0;
  let started = false;
  for (const text of textNodes(root)) {
    const next = total + text.data.length;
    if (!started && start <= next) {
      range.setStart(text, start - total);
      started = true;
    }
    if (started && end <= next) {
      range.setEnd(text, end - total);
      return range;
    }
    total = next;
  }
  return null;
}

/** How many times `quote` occurs in `text` before `start` (the occurrence a selection at `start` is). */
export function occurrenceAt(text: string, quote: string, start: number): number {
  let count = 0;
  for (let at = text.indexOf(quote); at >= 0 && at < start; at = text.indexOf(quote, at + 1)) count += 1;
  return count;
}

/** Where the `n`th (zero-based) occurrence of `quote` starts in `text`, or -1. */
export function occurrenceStart(text: string, quote: string, n: number): number {
  let at = text.indexOf(quote);
  for (let i = 0; i < n && at >= 0; i += 1) at = text.indexOf(quote, at + 1);
  return at;
}
