import { casual, type Component, type ParsedResult } from 'chrono-node/en';
import { IANAZone } from 'luxon';
import { isValidLocalDate, localDateOf, localParts } from '../time/resolve';
import { isKnownZone, UTC_ZONE } from '../time/zones';
import { ZONE_ABBREVIATIONS, zoneSuggestions } from './abbreviations';
import { MAX_CANDIDATES, MAX_DURATION_MS, MAX_SOURCE_TEXT, type DayPart } from './constants';
import { titleFor } from './title';
import type { Candidate, CandidateIntent, DateIntent, IsoWeekday, TimeIntent, ZoneIntent } from './types';

/**
 * Finds reminder phrases in English text (plan section 9.1, D-090). chrono-node reads the text against an explicit
 * reference instant and the selected zone's offset at that instant; only the values it is certain of, the matched
 * text and its tags are used. End-of-day phrases and zone abbreviations are masked with spaces first (offsets stay
 * the same), so chrono never turns an abbreviation into a fixed offset. No clock and no host zone are read here.
 */

interface Token {
  start: number;
  end: number;
  value: string;
}

interface Draft {
  start: number;
  end: number;
  intent: CandidateIntent;
  zone: ZoneIntent;
}

type Calendar = Draft & { intent: Extract<CandidateIntent, { kind: 'calendar' }> };

const SELECTED: ZoneIntent = { kind: 'selected' };
const EOD_RE = /\b(?:end\s+of\s+(?:the\s+)?day|EOD)\b/gi;
const ABBREVIATION_RE = new RegExp(`\\b(?:${ZONE_ABBREVIATIONS.join('|')}|UTC|GMT)\\b`, 'g');
const FIXED_UTC_RE = /^(?:UTC|GMT)$/;
/** What may stand between two parts of one phrase: spaces, commas and the words at, by, on, of. */
const JOINER_RE = /^[\s,]*(?:(?:at|by|on|of)[\s,]+)*$/i;

const CASUAL_DAYS: ReadonlyArray<[string, number]> = [
  ['casualReference/today', 0],
  ['casualReference/tonight', 0],
  ['casualReference/tomorrow', 1],
  ['casualReference/yesterday', -1],
];
const NUMBER_WORDS: Readonly<Record<string, number>> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COUNT = `(\\d+|${Object.keys(NUMBER_WORDS).join('|')})`;
const IN_DAYS_RE = new RegExp(`^(?:in|within) ${COUNT} (days?|weeks?)(?= |$)`);
const DAYS_FROM_NOW_RE = new RegExp(`^${COUNT} (days?|weeks?) from now(?= |$)`);
const DAY_AFTER_TOMORROW_RE = /^the day after tomorrow(?= |$)/;

const FULL_WEEKDAY_RE = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
/** Abbreviated weekdays count only when capitalized ("Sun", not "sun"). */
const SHORT_WEEKDAY_RE = /\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/;
const WEEKDAY_MODIFIER_RE = /^(this|next|last|on|by|coming)\s+/i;
const MAY_RE = /\bmay\b/i;
const NUMERIC_DATE_RE = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/;
const HOUR_TOKEN_RE = /(?<![\d/.:-])(\d{1,2})(?::[0-5]\d)?(?![\d/.-])/g;
const DAY_PART_RE = /\b(morning|afternoon|evening|night|tonight)\b/i;
const THIS_DAY_PART_TAGS = ['casualReference/morning', 'casualReference/afternoon', 'casualReference/evening'];

const MINUTE_HOUR_UNIT_RE = /(?:\d|\b)(?:min|mins|minutes?|h|hrs?|hours?)\b/i;
const OTHER_UNIT_RE = /(?:\d|\b)(?:s|secs?|seconds?|d|days?|w|wks?|weeks?|mos?|months?|y|yrs?|years?)\b/i;
/** A time right before a zone abbreviation that chrono did not read ("by 5 CST"). */
const TIME_BEFORE_ZONE_RE = /(?:\b(?:at|by|before|until)\s+)?((?<!\d)(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)?)\s*$/i;

export interface ParseOptions {
  referenceInstantUtc: number;
  /** A valid IANA zone: calendar words are counted in it. */
  zoneId: string;
}

/** The reminder phrases of `text`, sorted by position, at most MAX_CANDIDATES. Each phrase lies within one line. */
export function findCandidates(text: string, opts: ParseOptions): Candidate[] {
  const ref = opts.referenceInstantUtc;
  const offset = IANAZone.create(opts.zoneId).offset(ref);
  const todayYear = Number(localParts(ref, opts.zoneId).date.slice(0, 4));
  const found: Candidate[] = [];
  let lineStart = 0;
  for (const line of text.split('\n')) {
    for (const d of draftsOf(line, ref, offset)) {
      const phrase = line.slice(d.start, d.end);
      if (phrase.length > MAX_SOURCE_TEXT || !hasValidDate(d, todayYear)) continue;
      found.push({
        start: lineStart + d.start,
        end: lineStart + d.end,
        text: phrase,
        title: titleFor(line, d, ''),
        intent: d.intent,
        zone: d.zone,
        referenceInstantUtc: ref,
        parseZone: opts.zoneId,
      });
    }
    lineStart += line.length + 1;
  }
  return found.slice(0, MAX_CANDIDATES);
}

function draftsOf(line: string, ref: number, offset: number): Draft[] {
  const eods: Token[] = [];
  const abbreviations: Token[] = [];
  const masked = maskTokens(maskTokens(line, EOD_RE, eods), ABBREVIATION_RE, abbreviations);
  if (masked.trim() === '' && eods.length === 0) return [];
  const results = casual.parse(masked, { instant: new Date(ref), timezone: offset }, { forwardDate: false });
  let drafts = results.flatMap((r) => classify(r, ref) ?? []);
  drafts = applyEndOfDay(drafts, eods, line);
  drafts = applyZones(drafts, abbreviations, line);
  drafts = mergeTimeOnly(drafts, line);
  return withoutOverlaps(drafts);
}

function maskTokens(text: string, re: RegExp, into: Token[]): string {
  return text.replace(re, (value: string, index: number) => {
    into.push({ start: index, end: index + value.length, value });
    return ' '.repeat(value.length);
  });
}

// Classification -----------------------------------------------------------------------------
const known = (c: ParsedResult['start'], component: Component): number | null => (c.isCertain(component) ? c.get(component) : null);

function classify(r: ParsedResult, ref: number): Draft | null {
  const span = { start: r.index, end: r.index + r.text.length };
  const tags = r.tags();
  if (tags.has('casualReference/now')) return null;
  if (tags.has('result/relativeDateAndTime')) {
    const ms = durationMs(r, ref);
    return ms === null ? null : { ...span, intent: { kind: 'duration', ms }, zone: SELECTED };
  }
  const date = dateIntent(r);
  return date ? { ...span, intent: { kind: 'calendar', date, time: timeIntent(r) }, zone: SELECTED } : null;
}

/** Minutes and hours only; seconds, days and longer units in a duration are not reminders. */
function durationMs(r: ParsedResult, ref: number): number | null {
  if (!MINUTE_HOUR_UNIT_RE.test(r.text) || OTHER_UNIT_RE.test(r.text)) return null;
  const ms = r.start.date().getTime() - ref;
  return ms > 0 && ms <= MAX_DURATION_MS ? ms : null;
}

function dateIntent(r: ParsedResult): DateIntent | null {
  const tags = r.tags();
  const s = r.start;
  for (const [tag, days] of CASUAL_DAYS) if (tags.has(tag)) return { kind: 'relative', days };
  if (tags.has('result/relativeDate')) {
    const days = relativeDays(r.text);
    return days === null ? null : { kind: 'relative', days };
  }
  const day = known(s, 'day');
  const month = known(s, 'month');
  const weekday = known(s, 'weekday');
  if (weekday !== null && day === null) return weekdayIntent(r.text, weekday);
  if (day !== null && month !== null) return absoluteIntent(r.text, known(s, 'year'), month, day);
  if (known(s, 'hour') !== null) return { kind: 'none' };
  // "this evening": chrono is certain of nothing, the words say today.
  if (/^this\s/i.test(r.text) && THIS_DAY_PART_TAGS.some((t) => tags.has(t))) return { kind: 'relative', days: 0 };
  return null;
}

/** "in 3 days", "within a week", "2 weeks from now", "the day after tomorrow"; anything else relative is unsupported. */
function relativeDays(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (DAY_AFTER_TOMORROW_RE.test(t)) return 2;
  const m = IN_DAYS_RE.exec(t) ?? DAYS_FROM_NOW_RE.exec(t);
  if (!m) return null;
  const count = NUMBER_WORDS[m[1]!] ?? Number(m[1]);
  return m[2]!.startsWith('week') ? count * 7 : count;
}

function weekdayIntent(text: string, chronoWeekday: number): DateIntent | null {
  // "this weekend" is a weekday to chrono but names none.
  if (!FULL_WEEKDAY_RE.test(text) && !SHORT_WEEKDAY_RE.test(text)) return null;
  const modifier = WEEKDAY_MODIFIER_RE.exec(text)?.[1]?.toLowerCase();
  return {
    kind: 'weekday',
    weekday: (chronoWeekday === 0 ? 7 : chronoWeekday) as IsoWeekday,
    modifier: modifier === 'next' ? 'next' : modifier === 'last' ? 'last' : 'bare',
  };
}

function absoluteIntent(text: string, year: number | null, month: number, day: number): DateIntent | null {
  // The month "May" counts only when capitalized ("I may go 5" is not a date).
  const may = MAY_RE.exec(text);
  if (may && may[0] !== 'May') return null;
  const numeric = NUMERIC_DATE_RE.exec(text);
  const a = Number(numeric?.[1]);
  const b = Number(numeric?.[2]);
  const ambiguous = numeric !== null && a <= 12 && b <= 12 && a !== b;
  return { kind: 'absolute', year, month, day, order: ambiguous ? { month: day, day: month } : null };
}

function dayPartOf(text: string): DayPart | null {
  const word = DAY_PART_RE.exec(text)?.[1]?.toLowerCase();
  if (!word) return null;
  return word === 'night' || word === 'tonight' ? 'tonight' : (word as DayPart);
}

/** True when the written hour has a leading zero ("09:30" is 24-hour time). */
function hasLeadingZero(text: string, hour: number): boolean {
  let token: string | null = null;
  for (const m of text.matchAll(HOUR_TOKEN_RE)) if (Number(m[1]) === hour) token = m[1]!;
  return token !== null && token.length === 2 && token.startsWith('0');
}

function timeIntent(r: ParsedResult): TimeIntent {
  const tags = r.tags();
  const s = r.start;
  if (tags.has('casualReference/midnight')) return { kind: 'needsTime' };
  if (tags.has('casualReference/noon')) return { kind: 'explicit', hour: 12, minute: 0 };
  const part = dayPartOf(r.text);
  const hour = known(s, 'hour');
  if (hour === null) return part ? { kind: 'dayPart', part } : { kind: 'dateOnly' };
  const minute = known(s, 'minute') ?? 0;
  const meridiemOpen = !s.isCertain('meridiem') && !(r.end?.isCertain('meridiem') ?? false) && hour >= 1 && hour <= 12;
  if (!meridiemOpen) return { kind: 'explicit', hour, minute };
  if (part) return { kind: 'explicit', hour: part === 'morning' ? hour % 12 : (hour % 12) + 12, minute };
  if (hasLeadingZero(r.text, hour)) return { kind: 'explicit', hour, minute };
  return { kind: 'ambiguousHour', hour12: hour, minute };
}

// Merges -----------------------------------------------------------------------------------
const isCalendar = (d: Draft): d is Calendar => d.intent.kind === 'calendar';
const hasDate = (d: Draft): d is Calendar => isCalendar(d) && d.intent.date.kind !== 'none';
const isTimeOnly = (d: Draft): d is Calendar => isCalendar(d) && d.intent.date.kind === 'none';
const covers = (d: { start: number; end: number }, t: { start: number; end: number }) => d.start <= t.start && t.end <= d.end;

/** Two parts of one phrase: next to each other, with only spaces, commas or the joining words between them. */
function joined(line: string, a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  return first.end <= second.start && JOINER_RE.test(line.slice(first.end, second.start));
}

function withTime(d: Calendar, time: TimeIntent, span: { start: number; end: number }): Calendar {
  return { ...d, start: Math.min(d.start, span.start), end: Math.max(d.end, span.end), intent: { ...d.intent, time } };
}

/** "tomorrow end of the day", "EOD Friday": the date's default time becomes end of day; alone it means today. */
function applyEndOfDay(drafts: Draft[], eods: Token[], line: string): Draft[] {
  const out = [...drafts];
  for (const eod of eods) {
    const i = out.findIndex((d) => covers(d, eod) || (hasDate(d) && d.intent.time.kind === 'dateOnly' && joined(line, d, eod)));
    const owner = out[i];
    if (!owner) out.push({ ...eod, intent: { kind: 'calendar', date: { kind: 'relative', days: 0 }, time: { kind: 'endOfDay' } }, zone: SELECTED });
    else if (isCalendar(owner) && owner.intent.time.kind === 'dateOnly') out[i] = withTime(owner, { kind: 'endOfDay' }, eod);
  }
  return out;
}

function zoneIntentOf(abbr: string): ZoneIntent {
  if (FIXED_UTC_RE.test(abbr)) return { kind: 'fixed', zoneId: UTC_ZONE };
  return { kind: 'abbreviation', abbr, suggestions: zoneSuggestions(abbr, (zoneId) => isKnownZone(zoneId, null)) };
}

/** A zone abbreviation inside a phrase or right after it (at most 2 spaces) belongs to it; "by 5 CST" makes its own. */
function applyZones(drafts: Draft[], abbreviations: Token[], line: string): Draft[] {
  const out = [...drafts];
  for (const abbr of abbreviations) {
    const zone = zoneIntentOf(abbr.value);
    const i = out.findIndex((d) => covers(d, abbr) || (abbr.start >= d.end && /^ {0,2}$/.test(line.slice(d.end, abbr.start))));
    const owner = out[i];
    if (owner) {
      out[i] = { ...owner, end: Math.max(owner.end, abbr.end), zone: isCalendar(owner) && owner.zone.kind === 'selected' ? zone : owner.zone };
      continue;
    }
    const time = timeBefore(line.slice(0, abbr.start));
    if (time) out.push({ start: time.start, end: abbr.end, intent: { kind: 'calendar', date: { kind: 'none' }, time: time.intent }, zone });
  }
  return out;
}

/** The time written right before a zone abbreviation that chrono did not read, with its start. */
function timeBefore(before: string): { start: number; intent: TimeIntent } | null {
  const m = TIME_BEFORE_ZONE_RE.exec(before);
  if (!m) return null;
  const hour = Number(m[2]);
  const minute = m[3] ? Number(m[3]) : 0;
  const meridiem = m[4]?.toLowerCase().replace(/\./g, '');
  if (meridiem ? hour < 1 || hour > 12 : hour > 23) return null;
  const start = m.index + m[0].indexOf(m[1]!);
  if (meridiem) return { start, intent: { kind: 'explicit', hour: (hour % 12) + (meridiem === 'pm' ? 12 : 0), minute } };
  if (hour === 0 || hour > 12 || m[2]!.startsWith('0')) return { start, intent: { kind: 'explicit', hour, minute } };
  return { start, intent: { kind: 'ambiguousHour', hour12: hour, minute } };
}

/** A time-only phrase next to a date whose time is a default joins it; the written time wins. */
function mergeTimeOnly(drafts: Draft[], line: string): Draft[] {
  let out = [...drafts];
  for (const time of drafts.filter(isTimeOnly)) {
    const i = out.findIndex((d) => hasDate(d) && (d.intent.time.kind === 'dateOnly' || d.intent.time.kind === 'endOfDay') && joined(line, d, time));
    const date = out[i];
    if (!date || !isCalendar(date)) continue;
    out[i] = { ...withTime(date, time.intent.time, time), zone: time.zone.kind === 'selected' ? date.zone : time.zone };
    out = out.filter((d) => d !== time);
  }
  return out;
}

/** Overlapping phrases keep the longer one; the result is in text order. */
function withoutOverlaps(drafts: Draft[]): Draft[] {
  const kept: Draft[] = [];
  for (const d of [...drafts].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)) {
    if (!kept.some((k) => d.start < k.end && k.start < d.end)) kept.push(d);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** A written date must exist (in the year of today when no year is given) and lie between 2000 and 2100. */
function hasValidDate(d: Draft, todayYear: number): boolean {
  if (d.intent.kind !== 'calendar' || d.intent.date.kind !== 'absolute') return true;
  const { year, month, day } = d.intent.date;
  return isValidLocalDate(localDateOf(year ?? todayYear, month, day));
}
