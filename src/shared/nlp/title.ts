import { CONNECTORS, MAX_TITLE } from './constants';

const CONNECTOR_BEFORE = new RegExp(`(?:^|\\s)(?:${CONNECTORS.join('|')})\\s*$`, 'i');
const CONNECTOR_AT_END = new RegExp(`^\\s*(?:${CONNECTORS.join('|')})\\s*$`, 'i');
const EDGE_PUNCTUATION = /^[\s,;:\-–—]+|[\s,;:\-–—]+$/g;

/** Cuts at `max` characters on a word boundary, ending with "…". */
function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * A reminder title from the text around a phrase (D-093): the text without the phrase and without one connector word
 * ("by", "on", "at", …) directly before it, or after it at the end of the text; whitespace collapsed, punctuation
 * trimmed at both ends, at most 120 characters. `fallback` is used when nothing is left.
 */
export function titleFor(text: string, span: { start: number; end: number }, fallback: string): string {
  let before = text.slice(0, span.start);
  let after = text.slice(span.end);
  const connector = CONNECTOR_BEFORE.exec(before);
  if (connector) before = before.slice(0, connector.index);
  else if (CONNECTOR_AT_END.test(after)) after = '';
  const title = `${before} ${after}`.replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION, '');
  return title === '' ? fallback : shorten(title, MAX_TITLE);
}
