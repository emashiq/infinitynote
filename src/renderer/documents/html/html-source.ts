import { parseExternalUrl } from '../../../shared/url-policy';

/** A run of HTML source for the read-only Source view; only `text` runs are not highlighted. */
export interface SourceToken {
  kind: 'text' | 'tag' | 'name' | 'value' | 'comment' | 'declaration';
  text: string;
}

/** Elements whose content is not markup. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
const TAG_START = /<\/?([A-Za-z][^\s/>]*)/y;
const ATTRIBUTE = /(\s+)|(\/)|([^\s=/>]+)|(=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))/y;

/**
 * Splits HTML source into runs to color, in one linear pass that never builds a DOM: tags and their names, attribute
 * names and values, comments and declarations; everything else, and the content of scripts and styles, is text.
 */
export function tokenizeHtml(source: string): SourceToken[] {
  const out: SourceToken[] = [];
  const push = (kind: SourceToken['kind'], text: string) => {
    if (text === '') return;
    const last = out[out.length - 1];
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  const lower = source.toLowerCase();
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) {
      push('text', source.slice(i));
      break;
    }
    push('text', source.slice(i, lt));
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end < 0 ? source.length : end + 3;
      push('comment', source.slice(lt, i));
      continue;
    }
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const end = source.indexOf('>', lt);
      i = end < 0 ? source.length : end + 1;
      push('declaration', source.slice(lt, i));
      continue;
    }
    TAG_START.lastIndex = lt;
    const tag = TAG_START.exec(source);
    if (!tag) {
      push('text', '<');
      i = lt + 1;
      continue;
    }
    push('tag', tag[0]);
    let j = lt + tag[0].length;
    while (j < source.length && source[j] !== '>') {
      ATTRIBUTE.lastIndex = j;
      const a = ATTRIBUTE.exec(source);
      if (!a || a[0] === '') {
        push('text', source[j]!);
        j += 1;
        continue;
      }
      push(a[1] !== undefined ? 'text' : a[2] !== undefined ? 'tag' : a[3] !== undefined ? 'name' : 'value', a[0]);
      j += a[0].length;
    }
    if (j < source.length) push('tag', '>');
    i = j + 1;
    const name = tag[1]!.toLowerCase();
    if (!tag[0].startsWith('</') && RAW_TEXT.has(name)) {
      const close = lower.indexOf(`</${name}`, i);
      const end = close < 0 ? source.length : close;
      push('text', source.slice(i, end));
      i = end;
    }
  }
  return out;
}

/** At most this many links are listed for copying. */
export const MAX_LISTED_LINKS = 200;

/**
 * The web addresses a page links to, for "Copy link": parsed by the browser's inert DOMParser (no script runs and
 * nothing loads), http and https only, each once.
 */
export function externalLinks(source: string): string[] {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const links = new Set<string>();
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const parsed = parseExternalUrl(anchor.getAttribute('href')?.trim());
    if (parsed.ok) links.add(parsed.href);
    if (links.size >= MAX_LISTED_LINKS) break;
  }
  return [...links];
}
