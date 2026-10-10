/** Words a minute an adult reads silently, for "min read" (D-162). */
export const READING_WORDS_PER_MINUTE = 200;

export interface TextStats {
  words: number;
  /** Characters as people count them (graphemes), spaces included, line breaks not. */
  characters: number;
  /** Whole minutes to read, at least 1 when there are words. */
  readingMinutes: number;
}

const words = new Intl.Segmenter(undefined, { granularity: 'word' });
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Word and character counts and reading time of a note's text; words follow each script's rules (Bangla, CJK). */
export function textStats(text: string): TextStats {
  let wordCount = 0;
  for (const s of words.segment(text)) if (s.isWordLike) wordCount += 1;
  let characters = 0;
  for (const s of graphemes.segment(text)) if (s.segment !== '\n' && s.segment !== '\r\n') characters += 1;
  return { words: wordCount, characters, readingMinutes: wordCount === 0 ? 0 : Math.max(1, Math.round(wordCount / READING_WORDS_PER_MINUTE)) };
}

/** "120 words · 640 characters · 1 min read". */
export function formatStats(stats: TextStats): string {
  const plural = (n: number, one: string) => `${n.toLocaleString('en')} ${one}${n === 1 ? '' : 's'}`;
  return `${plural(stats.words, 'word')} · ${plural(stats.characters, 'character')} · ${stats.readingMinutes} min read`;
}
