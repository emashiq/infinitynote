import { addDays, isValidLocalDate, isoWeekday, localDateOf, localParts, localTimeOf, resolveLocal, type FoldPreference } from '../time/resolve';
import { DAY_PART_TIMES } from './constants';
import type { Candidate, CandidateResolution, Choices, DateIntent, Disclosure, MissingChoice, TimeIntent } from './types';

const MINUTE = 60_000;

export interface ResolveOptions {
  /** The selected zone ('' when none is chosen yet). */
  zoneId: string;
  choices: Choices;
  /** `reminders.endOfDayTime` and `reminders.dateOnlyTime` (D-094). */
  endOfDayTime: string;
  dateOnlyTime: string;
}

/** The zone a candidate resolves in: the user's choice, a fixed UTC phrase, else the selected zone. */
export function candidateZone(c: Candidate, opts: Pick<ResolveOptions, 'zoneId' | 'choices'>): string {
  if (opts.choices.zoneId) return opts.choices.zoneId;
  return c.zone.kind === 'fixed' ? c.zone.zoneId : opts.zoneId;
}

/** What the user still has to choose, in the order the card asks for it. */
export function missingChoices(c: Candidate, opts: Pick<ResolveOptions, 'zoneId' | 'choices'>): MissingChoice[] {
  const { choices } = opts;
  const missing: MissingChoice[] = [];
  if ((c.zone.kind === 'abbreviation' && !choices.zoneId) || candidateZone(c, opts) === '') missing.push('zone');
  if (c.intent.kind === 'calendar') {
    const { date, time } = c.intent;
    if (date.kind === 'absolute' && date.order && !choices.order) missing.push('order');
    if (time.kind === 'ambiguousHour' && !choices.meridiem) missing.push('meridiem');
    if (time.kind === 'needsTime' && !choices.time) missing.push('time');
  }
  return missing;
}

function timeOf(time: TimeIntent, opts: ResolveOptions): { time: string; disclosure: Disclosure | null } {
  switch (time.kind) {
    case 'explicit':
      return { time: localTimeOf(time.hour, time.minute), disclosure: null };
    case 'ambiguousHour':
      return { time: localTimeOf((time.hour12 % 12) + (opts.choices.meridiem === 'pm' ? 12 : 0), time.minute), disclosure: null };
    case 'endOfDay':
      return { time: opts.endOfDayTime, disclosure: { kind: 'endOfDay' } };
    case 'dateOnly':
      return { time: opts.dateOnlyTime, disclosure: { kind: 'dateOnly' } };
    case 'dayPart':
      return { time: DAY_PART_TIMES[time.part], disclosure: { kind: 'dayPart', part: time.part } };
    case 'needsTime':
      return { time: opts.choices.time!, disclosure: null };
  }
}

interface DateContext {
  today: string;
  time: string;
  zone: string;
  ref: number;
  fold: FoldPreference;
  choices: Choices;
}

const after = (ctx: DateContext, date: string) => resolveLocal({ date, time: ctx.time }, ctx.zone, ctx.fold).instantUtc > ctx.ref;

/** The calendar date of a date intent in the selected zone (ARCHITECTURE section 10). */
function dateOf(intent: DateIntent, ctx: DateContext): { date: string; yearOmitted: boolean } {
  const { today } = ctx;
  switch (intent.kind) {
    case 'relative':
      return { date: addDays(today, intent.days), yearOmitted: false };
    case 'none':
      return { date: after(ctx, today) ? today : addDays(today, 1), yearOmitted: false };
    case 'weekday': {
      const offset = (intent.weekday - isoWeekday(today) + 7) % 7;
      if (intent.modifier === 'next') return { date: addDays(today, 7 - (isoWeekday(today) - 1) + (intent.weekday - 1)), yearOmitted: false };
      if (intent.modifier === 'last') return { date: addDays(today, offset === 0 ? -7 : offset - 7), yearOmitted: false };
      // Bare: the first such day from today whose time is still ahead.
      const first = addDays(today, offset);
      return { date: after(ctx, first) ? first : addDays(first, 7), yearOmitted: false };
    }
    case 'absolute': {
      const { month, day } = intent.order && ctx.choices.order === 'swapped' ? intent.order : intent;
      if (intent.year !== null) return { date: localDateOf(intent.year, month, day), yearOmitted: false };
      const year = Number(today.slice(0, 4));
      const nextYear = localDateOf(year + 1, month, day);
      return { date: ctx.choices.useNextYear && isValidLocalDate(nextYear) ? nextYear : localDateOf(year, month, day), yearOmitted: true };
    }
  }
}

/**
 * Turns a candidate into a local date, time and instant in a zone (plan section 9.1), or lists the choices it still
 * needs. Calendar words count in the selected zone; durations keep their instant whatever the zone.
 */
export function resolveCandidate(c: Candidate, opts: ResolveOptions): CandidateResolution {
  const missing = missingChoices(c, opts);
  if (missing.length > 0) return { status: 'needsChoice', missing };
  const zone = candidateZone(c, opts);
  const ref = c.referenceInstantUtc;
  if (c.intent.kind === 'duration') {
    const instantUtc = Math.floor((ref + c.intent.ms) / MINUTE) * MINUTE;
    const local = localParts(instantUtc, zone);
    const earlier = resolveLocal(local, zone, 'earlier');
    return {
      status: 'ready',
      ...local,
      foldPreference: earlier.instantUtc === instantUtc ? 'earlier' : 'later',
      instantUtc,
      resolution: earlier.status === 'fold' ? 'fold' : 'ok',
      past: instantUtc <= ref,
      yearOmitted: false,
      relative: true,
      disclosure: null,
    };
  }
  const fold = opts.choices.fold ?? 'earlier';
  const { time, disclosure } = timeOf(c.intent.time, opts);
  const ctx: DateContext = { today: localParts(ref, zone).date, time, zone, ref, fold, choices: opts.choices };
  const { date, yearOmitted } = dateOf(c.intent.date, ctx);
  const r = resolveLocal({ date, time }, zone, fold);
  return {
    status: 'ready',
    date,
    time,
    foldPreference: fold,
    instantUtc: r.instantUtc,
    resolution: r.status,
    past: r.instantUtc <= ref,
    yearOmitted,
    relative: c.intent.date.kind !== 'absolute',
    disclosure,
  };
}
