/** Longest link address the app stores or opens. */
export const MAX_URL_LENGTH = 2048;

export type ParsedUrl = { ok: true; href: string } | { ok: false };

/**
 * The only addresses the app links to or opens (INF-SEC-01): absolute http or https URLs with a host and no
 * user name or password. Used at insert, at paste, when a document is normalized and before opening.
 */
export function parseExternalUrl(raw: unknown): ParsedUrl {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) return { ok: false };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false };
  if (url.hostname === '' || url.username !== '' || url.password !== '') return { ok: false };
  if (url.href.length > MAX_URL_LENGTH) return { ok: false };
  return { ok: true, href: url.href };
}
