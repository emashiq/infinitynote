/** A1 references as ExcelJS reports them (merges, filters), decoded to zero-based coordinates. */

export interface A1Range {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Zero-based coordinates of `B3` or `$B$3`, or null. */
export function decodeCell(ref: string): { r: number; c: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(ref.trim());
  if (!m) return null;
  const c = [...m[1]!.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { r: Number(m[2]) - 1, c };
}

/** Zero-based corners of `A1:C4` (or one cell), ordered; null when it is not a cell range. */
export function decodeRange(ref: string): A1Range | null {
  const [from, to = from] = ref.split(':');
  const a = decodeCell(from ?? '');
  const b = decodeCell(to ?? '');
  if (!a || !b || a.r < 0 || b.r < 0) return null;
  return { top: Math.min(a.r, b.r), left: Math.min(a.c, b.c), bottom: Math.max(a.r, b.r), right: Math.max(a.c, b.c) };
}
