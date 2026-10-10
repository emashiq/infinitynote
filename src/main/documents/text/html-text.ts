import { decodeHtmlEntities } from './entities';

/** Elements whose content is not page text. */
const SKIPPED = new Set(['script', 'style', 'template', 'noscript', 'svg', 'math']);
/** Elements that start a new line of text. */
const BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'title', 'tr', 'ul',
]);
const TAG_NAME = /^<\/?([A-Za-z][A-Za-z0-9-]*)/;

/**
 * The visible text of an HTML page for search, in one linear pass: comments and the content of scripts, styles and
 * similar elements are dropped, block elements become line breaks, entities are decoded and whitespace is collapsed.
 */
export function htmlToText(html: string): string {
  const lower = html.toLowerCase();
  const parts: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      parts.push(html.slice(i));
      break;
    }
    parts.push(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf('>', lt + 1);
    if (gt < 0) break;
    i = gt + 1;
    const name = TAG_NAME.exec(html.slice(lt, Math.min(gt + 1, lt + 40)))?.[1]?.toLowerCase();
    if (!name) continue;
    if (SKIPPED.has(name) && html[lt + 1] !== '/') {
      const close = lower.indexOf(`</${name}`, i);
      i = close < 0 ? html.length : (html.indexOf('>', close) + 1 || html.length);
      continue;
    }
    if (BLOCKS.has(name)) parts.push('\n');
  }
  return decodeHtmlEntities(parts.join(''))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}
