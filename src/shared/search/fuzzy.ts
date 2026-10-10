/**
 * Fuzzy title matching for the link picker (D-157). Bands, best first: the whole title, a prefix, a word that starts
 * with the query, the query anywhere, then the query's characters in order (a subsequence such as "mtg" in "Meeting
 * notes"). Inside a band a shorter title, an earlier match and fewer gaps rank higher. Case and accents do not matter.
 */

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase();

const WORD_START = /[\s\-_./()[\]]/;

/** The match score of `title` for `query` (higher is better), or null when it does not match. */
export function fuzzyScore(query: string, title: string): number | null {
  const q = fold(query.trim());
  const t = fold(title);
  if (q === '') return 0;
  const lengthPenalty = Math.min(t.length, 200) / 1000;
  if (t === q) return 5;
  if (t.startsWith(q)) return 4 - lengthPenalty;
  const at = t.indexOf(q);
  if (at > 0) {
    let word = at;
    while (word > 0 && !WORD_START.test(t[word - 1]!)) word = t.indexOf(q, word + 1);
    if (word > 0) return 3 - lengthPenalty - Math.min(word, 200) / 1e5;
    return 2 - lengthPenalty - Math.min(at, 200) / 1e5;
  }
  return subsequenceScore(q, t, lengthPenalty);
}

/** Every query character in order; each gap between matched characters costs a little. */
function subsequenceScore(q: string, t: string, lengthPenalty: number): number | null {
  let pos = 0;
  let gaps = 0;
  let last = -1;
  for (const ch of q) {
    if (/\s/.test(ch)) continue;
    const found = t.indexOf(ch, pos);
    if (found < 0) return null;
    if (last >= 0 && found > last + 1) gaps += 1;
    last = found;
    pos = found + 1;
  }
  return 1 - Math.min(gaps, 50) / 100 - lengthPenalty / 10;
}

/** Items that match, best first; ties keep the most recently updated first. */
export function rankByTitle<T>(query: string, items: readonly T[], titleOf: (item: T) => string, updatedAt: (item: T) => number): T[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyScore(query, titleOf(item));
    if (score !== null) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score || updatedAt(b.item) - updatedAt(a.item)).map((s) => s.item);
}
