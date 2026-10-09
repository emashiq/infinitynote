/**
 * The text a reminder source is compared against (D-092), shared by main (source checks, source-state sync) and the
 * renderer (what it sends). No parser here: main imports this module, never the parser.
 */

/** Blocks whose own text a source can point into; containers (list items, quotes) carry their paragraphs' IDs. */
const TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock']);
const MAX_DEPTH = 64;

interface JsonNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  attrs?: { id?: unknown } | null;
}

/** The dedupe form of a phrase: NFC, whitespace collapsed, trimmed, lower case. */
export function normalizePhrase(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Lower case that keeps every index: characters whose lower case has another length stay as they are. */
function foldCase(s: string): string {
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

/** Start indices of the non-overlapping, case-insensitive occurrences of `phrase`, scanned left to right. */
function matchStarts(text: string, phrase: string): number[] {
  if (phrase === '') return [];
  const hay = foldCase(text);
  const needle = foldCase(phrase);
  const starts: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) starts.push(i);
  return starts;
}

/** How many earlier occurrences of the same phrase (case-insensitive, non-overlapping) start before `start`. */
export function spanOrdinal(text: string, start: number, phrase: string): number {
  return matchStarts(text, phrase).filter((i) => i < start).length;
}

/** The number of non-overlapping, case-insensitive occurrences of `phrase` in `text`. */
export function occurrences(text: string, phrase: string): number {
  return matchStarts(text, phrase).length;
}

/** True when `text` still contains `phrase`, ignoring case (a source in state `ok`). */
export function containsPhrase(text: string, phrase: string): boolean {
  return phrase !== '' && foldCase(text).includes(foldCase(phrase));
}

/** The text of one textblock as the editor shows it: text nodes in order, a hard break as "\n". */
export function richBlockText(node: unknown): string {
  const n = node as JsonNode | null;
  if (!n || !Array.isArray(n.content)) return '';
  let out = '';
  for (const child of n.content as JsonNode[]) {
    if (child?.type === 'text' && typeof child.text === 'string') out += child.text;
    else if (child?.type === 'hardBreak') out += '\n';
  }
  return out;
}

/** The texts of the textblocks with these IDs, read in one walk; other IDs (absent, containers, images) are left out. */
export function richBlockTexts(doc: unknown, ids: ReadonlySet<string>): Map<string, string> {
  const texts = new Map<string, string>();
  const walk = (node: unknown, depth: number): void => {
    if (texts.size === ids.size || depth > MAX_DEPTH || node === null || typeof node !== 'object') return;
    const n = node as JsonNode;
    const id = n.attrs?.id;
    if (typeof n.type === 'string' && TEXT_BLOCK_TYPES.has(n.type)) {
      if (typeof id === 'string' && ids.has(id)) texts.set(id, richBlockText(n));
      return;
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child, depth + 1);
  };
  walk(doc, 0);
  return texts;
}
