import { z } from 'zod';

export const COMMON_LABEL = 'Common';
export const NAME_MESSAGE = 'Names must be 1 to 200 characters without control characters.';
export const TITLE_MESSAGE = 'Titles can be at most 200 characters without control characters.';

// U+0000-U+001F, U+007F, U+2028-U+2029
// eslint-disable-next-line no-control-regex
const FORBIDDEN = new RegExp('[\u0000-\u001F\u007F\u2028\u2029]');

export function normalizeName(raw: string): string {
  return raw.normalize('NFC').trim();
}
export const normalizeTitle = normalizeName;

function codePoints(s: string): number {
  return [...s].length;
}

/** Returns the user-facing error message, or null when the (already normalized) name is valid. */
export function validateName(s: string): string | null {
  const n = codePoints(s);
  if (n < 1 || n > 200 || FORBIDDEN.test(s)) return NAME_MESSAGE;
  return null;
}

export function validateTitle(s: string): string | null {
  if (codePoints(s) > 200 || FORBIDDEN.test(s)) return TITLE_MESSAGE;
  return null;
}

export function displayTitle(title: string): string {
  return title.length > 0 ? title : 'Untitled';
}

export const NameInput = z
  .string()
  .max(1000)
  .transform(normalizeName)
  .refine((s) => validateName(s) === null, 'Invalid name');

export const TitleInput = z
  .string()
  .max(1000)
  .transform(normalizeTitle)
  .refine((s) => validateTitle(s) === null, 'Invalid title');

/** A file name for an exported note: its title without characters Windows or Linux refuse, at most 100 characters. */
export function suggestedFileName(title: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return [...cleaned].slice(0, 100).join('') || 'Untitled';
}
