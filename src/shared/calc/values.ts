import type { DateTime } from 'luxon';

/**
 * The values of note math (D-188): numbers, percentages, dates and durations, and how results are written so that the
 * calculator reads them back.
 */

export const DURATION_UNITS = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

const UNIT_WORDS: Readonly<Record<string, DurationUnit>> = {
  second: 'second',
  seconds: 'second',
  sec: 'second',
  secs: 'second',
  minute: 'minute',
  minutes: 'minute',
  min: 'minute',
  mins: 'minute',
  hour: 'hour',
  hours: 'hour',
  hr: 'hour',
  hrs: 'hour',
  day: 'day',
  days: 'day',
  week: 'week',
  weeks: 'week',
  wk: 'week',
  wks: 'week',
  month: 'month',
  months: 'month',
  year: 'year',
  years: 'year',
  yr: 'year',
  yrs: 'year',
};

/** The unit a word names ("days", "hrs"), or null. */
export function unitOf(word: string): DurationUnit | null {
  return UNIT_WORDS[word.toLowerCase()] ?? null;
}

/** Calendar units: a date moves by whole ones (a month from 31 January is the end of February). */
export const CALENDAR_UNITS: ReadonlySet<DurationUnit> = new Set(['day', 'week', 'month', 'year']);

export type CalcValue =
  | { kind: 'number'; value: number }
  /** `value` is in percent: 10 % is 10. */
  | { kind: 'percent'; value: number }
  /** A date in the reference zone; `hasTime` when it carries a time of day (`now`, `+ 4 hours`). */
  | { kind: 'date'; value: DateTime; hasTime: boolean }
  /** An amount of one unit; the difference of two dates keeps them, so "in months" counts calendar months. */
  | { kind: 'duration'; amount: number; unit: DurationUnit; span?: { from: DateTime; to: DateTime } };

/** Why a text has no result; never shown, the suggestion just does not appear. */
export class CalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalcError';
  }
}

/** Days per unit for durations without dates: a month counts 30 days and a year 365, as Luxon's casual conversion. */
const DAYS: Readonly<Record<DurationUnit, number>> = { second: 1 / 86_400, minute: 1 / 1_440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };

/** A duration's amount in another unit: exact between dates, 12 months a year, otherwise through days. */
export function amountIn(duration: Extract<CalcValue, { kind: 'duration' }>, unit: DurationUnit): number {
  if (duration.unit === unit) return duration.amount;
  if (duration.span) return duration.span.to.diff(duration.span.from, `${unit}s`).get(`${unit}s`);
  if (duration.unit === 'year' && unit === 'month') return duration.amount * 12;
  if (duration.unit === 'month' && unit === 'year') return duration.amount / 12;
  return (duration.amount * DAYS[duration.unit]) / DAYS[unit];
}

/** The smaller of two units. */
export function smallerUnit(a: DurationUnit, b: DurationUnit): DurationUnit {
  return DURATION_UNITS.indexOf(a) <= DURATION_UNITS.indexOf(b) ? a : b;
}

const SIGNIFICANT_DIGITS = 10;

/** Up to 10 significant digits, trailing zeros trimmed, no grouping: `0.1 + 0.2` is `0.3`, `1/3` is `0.3333333333`. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new CalcError('The result is not a finite number');
  const rounded = Number(n.toPrecision(SIGNIFICANT_DIGITS));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** A result as the calculator reads it back: `12`, `15%`, `72 days`, `Nov 4, 2026`, `Oct 14, 2026 15:30`. */
export function formatValue(v: CalcValue): string {
  switch (v.kind) {
    case 'number':
      return formatNumber(v.value);
    case 'percent':
      return `${formatNumber(v.value)}%`;
    case 'duration': {
      const amount = formatNumber(v.amount);
      return `${amount} ${v.unit}${amount === '1' || amount === '-1' ? '' : 's'}`;
    }
    case 'date':
      return v.value.setLocale('en-US').toFormat(v.hasTime ? 'LLL d, yyyy HH:mm' : 'LLL d, yyyy');
  }
}
