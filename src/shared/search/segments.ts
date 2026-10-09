/**
 * Search highlights travel as text segments, never as markup (INF-SRCH-04): main asks SQLite to wrap hits in two
 * control characters and splits on them; the renderer turns each segment into a text node.
 */
export const HIT_START = '\u0002';
export const HIT_END = '\u0003';

export interface Segment {
  text: string;
  hit: boolean;
}

/** Splits marked text into plain and hit segments; stray or unbalanced markers are dropped, empty runs merged away. */
export function parseMarked(marked: string): Segment[] {
  const out: Segment[] = [];
  let hit = false;
  let text = '';
  const flush = () => {
    if (text === '') return;
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += text;
    else out.push({ text, hit });
    text = '';
  };
  for (const ch of marked) {
    if (ch === HIT_START || ch === HIT_END) {
      flush();
      hit = ch === HIT_START;
    } else {
      text += ch;
    }
  }
  flush();
  return out;
}

/** Marks every case-insensitive occurrence of `needle` in `text` (the short-query title fallback). */
export function markSubstring(text: string, needle: string): Segment[] {
  const q = needle.toLocaleLowerCase();
  if (q === '') return text === '' ? [] : [{ text, hit: false }];
  const lower = text.toLocaleLowerCase();
  // Lower-casing can change lengths for a few characters; then the title is shown without a highlight.
  if (lower.length !== text.length) return [{ text, hit: false }];
  const out: Segment[] = [];
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
    if (i > at) out.push({ text: text.slice(at, i), hit: false });
    out.push({ text: text.slice(i, i + q.length), hit: true });
    at = i + q.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}
