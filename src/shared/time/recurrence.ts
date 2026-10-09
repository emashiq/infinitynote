import { addDays, isoWeekday, localParts, resolveLocal, type FoldPreference } from './resolve';

/** Daily, or weekly on ISO weekdays (1 = Monday … 7 = Sunday). */
export type RecurrenceRule = { freq: 'daily' } | { freq: 'weekly'; byWeekday: readonly number[] };

/** A recurring series on the wall clock of its zone (INF-REM-12): every matching date from `startDate` at `time`. */
export interface Series {
  rule: RecurrenceRule;
  startDate: string;
  time: string;
  zoneId: string;
  fold: FoldPreference;
}

/** Any rule matches within a week, so every search below is bounded by this many dates. */
const WEEK = 7;

function matches(rule: RecurrenceRule, date: string): boolean {
  return rule.freq === 'daily' || rule.byWeekday.includes(isoWeekday(date));
}

/** The first matching date on or after both the series start and `fromDate`. */
export function firstOnOrAfter(rule: RecurrenceRule, startDate: string, fromDate: string): string {
  let date = fromDate > startDate ? fromDate : startDate;
  for (let i = 0; i < WEEK && !matches(rule, date); i += 1) date = addDays(date, 1);
  return date;
}

/** The first matching date strictly after `date`. */
export function nextAfter(rule: RecurrenceRule, date: string): string {
  return firstOnOrAfter(rule, addDays(date, 1), addDays(date, 1));
}

/** The instant of one occurrence date: a gap resolves for that day only, a fold to one instant by preference. */
export function occurrenceInstant(series: Series, date: string): number {
  return resolveLocal({ date, time: series.time }, series.zoneId, series.fold).instantUtc;
}

/**
 * The newest occurrence due at or before `instant`, or null before the first one. It looks back over at most a week of
 * dates, so a series after a long downtime costs the same as after a short one (D-078).
 */
export function latestAtOrBefore(series: Series, instant: number): { date: string; instantUtc: number } | null {
  let date = localParts(instant, series.zoneId).date;
  for (let i = 0; i <= WEEK && date >= series.startDate; i += 1, date = addDays(date, -1)) {
    if (!matches(series.rule, date)) continue;
    const instantUtc = occurrenceInstant(series, date);
    if (instantUtc <= instant) return { date, instantUtc };
  }
  return null;
}

/** The first occurrence due strictly after `instant`. */
export function firstAfter(series: Series, instant: number): { date: string; instantUtc: number } {
  let date = firstOnOrAfter(series.rule, series.startDate, localParts(instant, series.zoneId).date);
  for (;;) {
    const instantUtc = occurrenceInstant(series, date);
    if (instantUtc > instant) return { date, instantUtc };
    date = nextAfter(series.rule, date);
  }
}
