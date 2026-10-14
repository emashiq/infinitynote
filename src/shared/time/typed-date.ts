/**
 * Dates typed as numbers (D-184): what a spreadsheet cell reads as a date. Recognized are `d-m-yyyy`, `d/m/yyyy` and
 * `d.m.yyyy` (day first), `m/d/yyyy` (month first) and `yyyy-m-d` (also with `/` or `.`), each optionally followed by
 * a time (`14:30`, `14:30:05`, `2:30 PM`). One separator throughout, a four-digit year from 1900. When day and month
 * could be either way round (both 12 or less) the computer's date order decides; a part over 12 is always the day.
 */

/** Which of the two first numbers of "10/05/2026" is the day, from the computer's regional settings. */
export type DateOrder = 'day-first' | 'month-first';

export interface TypedDate {
  /** The day number of Excel's 1900 date system, with the time as a fraction of the day. */
  serial: number;
  /** An Excel number format that shows the date (and time) the way it was typed: `dd-mm-yyyy`, `m/d/yyyy h:mm AM/PM`. */
  format: string;
}

const MIN_YEAR = 1900;
const DAY_MS = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const TIME = String.raw`(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?)?`;
const YEAR_FIRST = new RegExp(String.raw`^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})${TIME}$`);
const YEAR_LAST = new RegExp(String.raw`^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})${TIME}$`);

/** A typed date's calendar parts, with what the format of the typed text needs. */
export interface TypedDateParts {
  year: number;
  month: number;
  day: number;
  /** The time of day as a fraction of the day, or null when none was typed. */
  time: { fraction: number; format: string } | null;
  /** How it was typed: the separator, the digits of day and month, and which came first. */
  typed: { separator: string; day: string; month: string; order: 'year-first' | 'day-first' | 'month-first' };
}

/**
 * The calendar date of a typed date (D-184), or null when the text is not a valid date in one of the forms above.
 * Spreadsheets (parseTypedDate) and math results in notes (D-188) read dates with it.
 */
export function readTypedDate(text: string, order: DateOrder): TypedDateParts | null {
  const trimmed = text.trim();
  const yearFirst = YEAR_FIRST.exec(trimmed);
  const yearLast = yearFirst ? null : YEAR_LAST.exec(trimmed);
  const m = yearFirst ?? yearLast;
  if (!m) return null;
  const separator = m[2]!;
  const year = Number(yearFirst ? m[1] : m[4]);
  let typed: TypedDateParts['typed'];
  if (yearFirst) typed = { separator, month: m[3]!, day: m[4]!, order: 'year-first' };
  else {
    const [a, b] = [m[1]!, m[3]!];
    const dayFirst = Number(a) > 12 ? true : Number(b) > 12 ? false : order === 'day-first';
    typed = dayFirst ? { separator, day: a, month: b, order: 'day-first' } : { separator, day: b, month: a, order: 'month-first' };
  }
  const day = Number(typed.day);
  const month = Number(typed.month);
  if (year < MIN_YEAR || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const time = timeOf(m.slice(5, 9));
  if (time === undefined) return null;
  return { year, month, day, time, typed };
}

/** A spreadsheet date for the text, or null when it is not a valid date in one of the forms above. */
export function parseTypedDate(text: string, order: DateOrder): TypedDate | null {
  const parts = readTypedDate(text, order);
  if (!parts) return null;
  const { year, month, day, time, typed } = parts;
  const tokens = (digits: string, letter: string) => (digits.length === 2 ? letter + letter : letter);
  const literal = typed.separator === '.' ? '"."' : typed.separator;
  const dateTokens =
    typed.order === 'year-first'
      ? ['yyyy', tokens(typed.month, 'm'), tokens(typed.day, 'd')]
      : typed.order === 'day-first'
        ? [tokens(typed.day, 'd'), tokens(typed.month, 'm'), 'yyyy']
        : [tokens(typed.month, 'm'), tokens(typed.day, 'd'), 'yyyy'];
  const format = dateTokens.join(literal) + (time ? ` ${time.format}` : '');
  return { serial: excelSerial(year, month, day) + (time?.fraction ?? 0), format };
}

/**
 * The typed time as a fraction of the day and its format; null when there is none; undefined when it is not a valid
 * time (25:00, 13 PM, 10:61).
 */
function timeOf([h, min, s, meridiem]: Array<string | undefined>): { fraction: number; format: string } | null | undefined {
  if (h === undefined) return null;
  let hours = Number(h);
  const minutes = Number(min);
  const seconds = s === undefined ? 0 : Number(s);
  if (minutes > 59 || seconds > 59) return undefined;
  if (meridiem) {
    if (hours < 1 || hours > 12) return undefined;
    hours = (hours % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  } else if (hours > 23) return undefined;
  const format = `${h.length === 2 && !meridiem ? 'hh' : 'h'}:mm${s === undefined ? '' : ':ss'}${meridiem ? ' AM/PM' : ''}`;
  return { fraction: (hours * 3600 + minutes * 60 + seconds) / 86_400, format };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Excel's day number of a date; Excel counts a 29 February 1900 that never was, so earlier dates are one lower. */
function excelSerial(year: number, month: number, day: number): number {
  const days = (Date.UTC(year, month - 1, day) - EXCEL_EPOCH) / DAY_MS;
  return days < 61 ? days - 1 : days;
}

/**
 * The date order of a locale's short dates (`en-GB` and `bn-BD` day first, `en-US` month first, `ja-JP` year then
 * month: month first). Unknown or invalid locales read as day first, the order most of the world writes.
 */
export function dateOrderOf(locale: string): DateOrder {
  try {
    const parts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.UTC(2026, 9, 25)));
    const index = (type: Intl.DateTimeFormatPartTypes) => parts.findIndex((p) => p.type === type);
    return index('month') < index('day') ? 'month-first' : 'day-first';
  } catch {
    return 'day-first';
  }
}
