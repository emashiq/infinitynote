import type { FoldPreference } from '../time/resolve';
import type { DayPart } from './constants';

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** What a phrase says about the calendar date (plan section 9.1). */
export type DateIntent =
  /** A written date; `order` is the swapped reading when the numeric order is ambiguous ("03/04"). */
  | { kind: 'absolute'; year: number | null; month: number; day: number; order: { month: number; day: number } | null }
  /** Calendar days from today in the selected zone: today 0, tomorrow 1, yesterday -1, in N weeks 7N. */
  | { kind: 'relative'; days: number }
  /** "this", "on", "by" and "coming" count as bare. */
  | { kind: 'weekday'; weekday: IsoWeekday; modifier: 'bare' | 'next' | 'last' }
  /** A time-only phrase ("at 5pm"). */
  | { kind: 'none' };

/** What a phrase says about the time of day. */
export type TimeIntent =
  | { kind: 'explicit'; hour: number; minute: number }
  /** A bare hour 1-12 without am/pm: the user chooses. */
  | { kind: 'ambiguousHour'; hour12: number; minute: number }
  | { kind: 'endOfDay' }
  | { kind: 'dateOnly' }
  | { kind: 'dayPart'; part: DayPart }
  /** "midnight": the user enters a time. */
  | { kind: 'needsTime' };

export type ZoneIntent = { kind: 'selected' } | { kind: 'fixed'; zoneId: string } | { kind: 'abbreviation'; abbr: string; suggestions: string[] };

export type CandidateIntent = { kind: 'calendar'; date: DateIntent; time: TimeIntent } | { kind: 'duration'; ms: number };

/** A date or time phrase found in some text. Offsets are UTF-16 indices into that text. */
export interface Candidate {
  start: number;
  end: number;
  /** The phrase exactly as written. */
  text: string;
  /** The text without the phrase (empty when nothing is left). */
  title: string;
  intent: CandidateIntent;
  zone: ZoneIntent;
  referenceInstantUtc: number;
  /** The zone the phrase was read in. */
  parseZone: string;
}

/** The user's answers to what a phrase leaves open. */
export interface Choices {
  order?: 'asWritten' | 'swapped';
  meridiem?: 'am' | 'pm';
  zoneId?: string;
  /** `HH:mm` for a phrase that needs a time ("midnight"). */
  time?: string;
  useNextYear?: boolean;
  fold?: FoldPreference;
}

export type MissingChoice = 'zone' | 'order' | 'meridiem' | 'time';

export type Disclosure = { kind: 'endOfDay' } | { kind: 'dateOnly' } | { kind: 'dayPart'; part: DayPart };

export type CandidateResolution =
  | { status: 'needsChoice'; missing: MissingChoice[] }
  | {
      status: 'ready';
      date: string;
      time: string;
      foldPreference: FoldPreference;
      instantUtc: number;
      resolution: 'ok' | 'gap' | 'fold';
      past: boolean;
      /** A written date without a year: the year of today in the selected zone. */
      yearOmitted: boolean;
      /** The date depends on when the phrase was read (relative days, weekdays, time-only, durations). */
      relative: boolean;
      /** The time came from a default: shown next to the time while it is unchanged. */
      disclosure: Disclosure | null;
    };
