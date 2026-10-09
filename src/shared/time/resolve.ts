import { IANAZone } from 'luxon';

/** A wall-clock date and time in some zone: `YYYY-MM-DD` and `HH:mm`. */
export interface LocalDateTime {
  date: string;
  time: string;
}

export type FoldPreference = 'earlier' | 'later';

/** How a local date and time maps to an instant (D-079): exactly, inside a DST gap, or inside a fold. */
export type Resolution =
  | { status: 'ok'; instantUtc: number }
  | { status: 'gap'; instantUtc: number }
  | { status: 'fold'; instantUtc: number; alternatives: [number, number] };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SEARCH_SPAN = 14 * HOUR;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** A real calendar date `YYYY-MM-DD` between the years 2000 and 2100. */
export function isValidLocalDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_YEAR || y > MAX_YEAR || mo < 1 || mo > 12 || d < 1) return false;
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDate() === d;
}

/** A 24-hour time `HH:mm`. */
export function isValidLocalTime(time: string): boolean {
  return TIME_RE.test(time);
}

function zoneOf(zoneId: string): IANAZone {
  const zone = IANAZone.create(zoneId);
  if (!zone.isValid) throw new RangeError(`Unknown time zone: ${zoneId}`);
  return zone;
}

/** `YYYY-MM-DDTHH:mm` of an instant on the wall clock of a zone (fixed width, so strings compare in time order). */
function wallKey(instant: number, zone: IANAZone): string {
  return new Date(instant + zone.offset(instant) * MINUTE).toISOString().slice(0, 16);
}

/** The wall-clock date and time of an instant in a zone. */
export function localParts(instant: number, zoneId: string): LocalDateTime {
  const key = wallKey(instant, zoneOf(zoneId));
  return { date: key.slice(0, 10), time: key.slice(11, 16) };
}

/**
 * Resolves a wall-clock date and time in a zone to an instant (plan section 9.1). Candidates come from the zone's
 * offsets 12 hours before and after the naive instant; one match is `ok`, two are a `fold` (earlier unless `later` is
 * preferred), none is a `gap`, which resolves to the first valid minute after it. Throws RangeError for an invalid
 * date, time or zone (callers validate first).
 */
export function resolveLocal({ date, time }: LocalDateTime, zoneId: string, fold: FoldPreference = 'earlier'): Resolution {
  if (!isValidLocalDate(date) || !isValidLocalTime(time)) throw new RangeError(`Invalid local date or time: ${date} ${time}`);
  const zone = zoneOf(zoneId);
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, mo - 1, d, hh, mm);
  const want = `${date}T${time}`;
  const candidates = [...new Set([naive - zone.offset(naive - 12 * HOUR) * MINUTE, naive - zone.offset(naive + 12 * HOUR) * MINUTE])]
    .filter((instant) => wallKey(instant, zone) === want)
    .sort((a, b) => a - b);
  if (candidates.length === 1) return { status: 'ok', instantUtc: candidates[0]! };
  if (candidates.length === 2) {
    const [earlier, later] = candidates as [number, number];
    return { status: 'fold', instantUtc: fold === 'later' ? later : earlier, alternatives: [earlier, later] };
  }
  // Gap: the first whole minute whose wall clock reads at or after the requested time.
  let lo = naive - SEARCH_SPAN;
  let hi = naive + SEARCH_SPAN;
  while (hi - lo > MINUTE) {
    const mid = Math.floor((lo + hi) / 2 / MINUTE) * MINUTE;
    if (wallKey(mid, zone) < want) lo = mid;
    else hi = mid;
  }
  return { status: 'gap', instantUtc: hi };
}

/** The calendar date `days` after (or before, when negative) a local date. */
export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d) + days * DAY).toISOString().slice(0, 10);
}

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of a year, month and day (not validated). */
export function localDateOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** `HH:mm` of an hour and minute (not validated). */
export function localTimeOf(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}
