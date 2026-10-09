import { afterEach, describe, expect, it, vi } from 'vitest';
import { findCandidates } from '../../src/shared/nlp/parse';
import { resolveCandidate } from '../../src/shared/nlp/resolve-candidate';
import type { Candidate, CandidateResolution, Choices } from '../../src/shared/nlp/types';
import { isKnownZone } from '../../src/shared/time/zones';

/** Reference R: Thu 2026-10-08 13:00 in Dhaka (PRODUCT_SPEC section 6). */
const R = Date.parse('2026-10-08T07:00:00Z');
const DHAKA = 'Asia/Dhaka';
const NY = 'America/New_York';
const utc = (iso: string) => Date.parse(iso);

interface Opts {
  zone?: string;
  ref?: number;
  choices?: Choices;
  endOfDayTime?: string;
  dateOnlyTime?: string;
}

function candidates(text: string, opts: Opts = {}): Candidate[] {
  return findCandidates(text, { referenceInstantUtc: opts.ref ?? R, zoneId: opts.zone ?? DHAKA });
}

function only(text: string, opts: Opts = {}): Candidate {
  const found = candidates(text, opts);
  expect(found, text).toHaveLength(1);
  return found[0]!;
}

function resolve(c: Candidate, opts: Opts = {}): CandidateResolution {
  return resolveCandidate(c, {
    zoneId: opts.zone ?? DHAKA,
    choices: opts.choices ?? {},
    endOfDayTime: opts.endOfDayTime ?? '17:00',
    dateOnlyTime: opts.dateOnlyTime ?? '09:00',
  });
}

type Ready = Extract<CandidateResolution, { status: 'ready' }>;

function ready(text: string, opts: Opts = {}): Ready {
  const r = resolve(only(text, opts), opts);
  if (r.status !== 'ready') throw new Error(`${text}: ${JSON.stringify(r)}`);
  return r;
}

/** Date, time and instant of a phrase, the fields the PRODUCT_SPEC table lists. */
function at(text: string, opts: Opts = {}) {
  const r = ready(text, opts);
  return { date: r.date, time: r.time, utc: new Date(r.instantUtc).toISOString() };
}

describe('PRODUCT_SPEC section 6 frozen-clock contract (C1-C22)', () => {
  it('C1 "tomorrow end of the day": one candidate over the whole phrase, Fri 17:00, end-of-day default disclosed', () => {
    const c = only('tomorrow end of the day');
    expect([c.start, c.end, c.text]).toEqual([0, 23, 'tomorrow end of the day']);
    const r = ready('tomorrow end of the day');
    expect(at('tomorrow end of the day')).toEqual({ date: '2026-10-09', time: '17:00', utc: '2026-10-09T11:00:00.000Z' });
    expect(r.disclosure).toEqual({ kind: 'endOfDay' });
  });

  it('C2 phrase in a sentence: span 23-46, title without the phrase and "by"', () => {
    const c = only('Have to submit this by tomorrow end of the day');
    expect([c.start, c.end]).toEqual([23, 46]);
    expect(c.title).toBe('Have to submit this');
    expect(resolve(c)).toMatchObject({ status: 'ready', instantUtc: utc('2026-10-09T11:00:00Z') });
  });

  it('C3 explicit time, either case: 20:00 without a disclosure', () => {
    for (const text of ['tomorrow at 8pm', 'Tomorrow at 8pm']) {
      expect(at(text)).toEqual({ date: '2026-10-09', time: '20:00', utc: '2026-10-09T14:00:00.000Z' });
      expect(ready(text).disclosure).toBeNull();
    }
  });

  it('C4 "in 2 hours" is instant arithmetic', () => {
    expect(only('in 2 hours').intent).toEqual({ kind: 'duration', ms: 2 * 3_600_000 });
    expect(at('in 2 hours')).toEqual({ date: '2026-10-08', time: '15:00', utc: '2026-10-08T09:00:00.000Z' });
  });

  it('C5 "tomorrow": the date-only default 09:00, disclosed', () => {
    expect(at('tomorrow')).toEqual({ date: '2026-10-09', time: '09:00', utc: '2026-10-09T03:00:00.000Z' });
    expect(ready('tomorrow').disclosure).toEqual({ kind: 'dateOnly' });
  });

  it('C6 "end of day" alone means today', () => {
    expect(at('end of day')).toEqual({ date: '2026-10-08', time: '17:00', utc: '2026-10-08T11:00:00.000Z' });
  });

  it('C7-C15 weekday table', () => {
    const table: Array<[string, string, string]> = [
      ['Friday', '2026-10-09', '09:00'],
      ['this Friday', '2026-10-09', '09:00'],
      ['Friday at 5pm', '2026-10-09', '17:00'],
      ['next Friday', '2026-10-16', '09:00'],
      ['Thursday', '2026-10-15', '09:00'],
      ['Thursday 5pm', '2026-10-08', '17:00'],
      ['next Thursday', '2026-10-15', '09:00'],
      ['Monday', '2026-10-12', '09:00'],
      ['next Monday', '2026-10-12', '09:00'],
      ['Sunday', '2026-10-11', '09:00'],
      ['next Sunday', '2026-10-18', '09:00'],
      ['last Friday', '2026-10-02', '09:00'],
    ];
    for (const [text, date, time] of table) expect({ text, ...at(text) }).toMatchObject({ text, date, time });
    expect(at('Friday').utc).toBe('2026-10-09T03:00:00.000Z');
    expect(at('Friday at 5pm').utc).toBe('2026-10-09T11:00:00.000Z');
    expect(at('next Friday').utc).toBe('2026-10-16T03:00:00.000Z');
    expect(at('Thursday 5pm').utc).toBe('2026-10-08T11:00:00.000Z');
    expect(at('Monday').utc).toBe('2026-10-12T03:00:00.000Z');
    expect(ready('last Friday')).toMatchObject({ past: true, yearOmitted: false, relative: true });
  });

  it('C16 "03/04 at 5" needs the date order and am/pm; the year-omitted date is past until "Use next year"', () => {
    const c = only('03/04 at 5');
    expect(resolve(c)).toEqual({ status: 'needsChoice', missing: ['order', 'meridiem'] });
    expect(resolve(c, { choices: { order: 'swapped' } })).toEqual({ status: 'needsChoice', missing: ['meridiem'] });
    const chosen = resolve(c, { choices: { order: 'swapped', meridiem: 'pm' } });
    expect(chosen).toMatchObject({ status: 'ready', date: '2026-04-03', time: '17:00', past: true, yearOmitted: true });
    const asWritten = resolve(c, { choices: { order: 'asWritten', meridiem: 'am' } });
    expect(asWritten).toMatchObject({ status: 'ready', date: '2026-03-04', time: '05:00' });
    const next = resolve(c, { choices: { order: 'swapped', meridiem: 'pm', useNextYear: true } });
    expect(next).toMatchObject({ status: 'ready', date: '2027-04-03', time: '17:00', instantUtc: utc('2027-04-03T11:00:00Z'), past: false });
  });

  it('C17 "on Oct 1" stays in 2026 and past; never 2027 unless "Use next year"', () => {
    const r = ready('on Oct 1');
    expect(r).toMatchObject({ date: '2026-10-01', time: '09:00', instantUtc: utc('2026-10-01T03:00:00Z'), past: true, yearOmitted: true });
    expect(ready('on Oct 1', { choices: { useNextYear: true } }).date).toBe('2027-10-01');
  });

  it('C18 "by 5 CST" needs a zone (no default) and am/pm; America/Chicago and pm give 17:00 CDT', () => {
    const c = only('by 5 CST');
    expect(c.text).toBe('5 CST');
    expect(c.zone).toMatchObject({ kind: 'abbreviation', abbr: 'CST' });
    expect(c.zone.kind === 'abbreviation' && c.zone.suggestions.slice(0, 3)).toEqual(['America/Chicago', 'Asia/Shanghai', 'America/Havana']);
    expect(resolve(c)).toEqual({ status: 'needsChoice', missing: ['zone', 'meridiem'] });
    expect(resolve(c, { choices: { zoneId: 'America/Chicago', meridiem: 'pm' } })).toMatchObject({
      status: 'ready',
      date: '2026-10-08',
      time: '17:00',
      instantUtc: utc('2026-10-08T22:00:00Z'),
    });
  });

  it('C19 and C20 near midnight: "tomorrow at 9am" is Oct 8 in New York and Oct 9 in Dhaka', () => {
    const ref = utc('2026-10-08T03:30:00Z');
    expect(at('tomorrow at 9am', { zone: NY, ref })).toEqual({ date: '2026-10-08', time: '09:00', utc: '2026-10-08T13:00:00.000Z' });
    expect(at('tomorrow at 9am', { zone: DHAKA, ref })).toEqual({ date: '2026-10-09', time: '09:00', utc: '2026-10-09T03:00:00.000Z' });
  });

  it('C21 a time in the spring-forward gap resolves to the first valid instant', () => {
    expect(ready('2026-03-08 02:30', { zone: NY })).toMatchObject({ resolution: 'gap', instantUtc: utc('2026-03-08T07:00:00Z'), past: true });
  });

  it('C22 a time in the fall-back fold: earlier by default, later when chosen', () => {
    expect(ready('2026-11-01 01:30', { zone: NY })).toMatchObject({ resolution: 'fold', instantUtc: utc('2026-11-01T05:30:00Z') });
    expect(ready('2026-11-01 01:30', { zone: NY, choices: { fold: 'later' } })).toMatchObject({ resolution: 'fold', instantUtc: utc('2026-11-01T06:30:00Z') });
  });
});

describe('PRODUCT_SPEC section 6 plan rules (D-090, P1-P40)', () => {
  it('P1 "by EOD": the EOD phrase alone is today 17:00; the connector leaves the title', () => {
    const c = only('by EOD');
    expect(c.text).toBe('EOD');
    expect(c.title).toBe('');
    expect(at('by EOD')).toMatchObject({ date: '2026-10-08', time: '17:00' });
  });

  it('P2 EOD with a weekday on either side', () => {
    for (const text of ['EOD Friday', 'Friday EOD', 'by end of the day Friday']) expect(at(text)).toMatchObject({ date: '2026-10-09', time: '17:00' });
    expect(only('by end of the day Friday').text).toBe('end of the day Friday');
  });

  it('P3 an explicit time wins over end of day', () => {
    const r = ready('tomorrow end of the day at 6pm');
    expect(r).toMatchObject({ date: '2026-10-09', time: '18:00', instantUtc: utc('2026-10-09T12:00:00Z'), disclosure: null });
  });

  it('P4 and P5 the settings move the default times', () => {
    expect(at('tomorrow EOD', { endOfDayTime: '18:30' })).toEqual({ date: '2026-10-09', time: '18:30', utc: '2026-10-09T12:30:00.000Z' });
    expect(at('tomorrow', { dateOnlyTime: '07:45' })).toEqual({ date: '2026-10-09', time: '07:45', utc: '2026-10-09T01:45:00.000Z' });
  });

  it('P6 and P7 today', () => {
    expect(at('today at 5pm')).toMatchObject({ date: '2026-10-08', time: '17:00' });
    expect(ready('today')).toMatchObject({ date: '2026-10-08', time: '09:00', past: true, yearOmitted: false });
  });

  it('P8-P11 day parts use fixed disclosed times; noon is explicit', () => {
    for (const text of ['tonight', 'by tonight']) {
      expect(ready(text)).toMatchObject({ date: '2026-10-08', time: '20:00', instantUtc: utc('2026-10-08T14:00:00Z'), disclosure: { kind: 'dayPart', part: 'tonight' } });
    }
    expect(ready('this evening')).toMatchObject({ date: '2026-10-08', time: '19:00', instantUtc: utc('2026-10-08T13:00:00Z'), disclosure: { kind: 'dayPart', part: 'evening' } });
    expect(at('tomorrow morning').time).toBe('09:00');
    expect(at('tomorrow afternoon').time).toBe('15:00');
    expect(at('tomorrow night').time).toBe('20:00');
    expect(ready('noon tomorrow')).toMatchObject({ date: '2026-10-09', time: '12:00', disclosure: null });
  });

  it('P12 midnight needs a time', () => {
    const c = only('tomorrow midnight');
    expect(resolve(c)).toEqual({ status: 'needsChoice', missing: ['time'] });
    expect(resolve(c, { choices: { time: '23:59' } })).toMatchObject({ status: 'ready', date: '2026-10-09', time: '23:59', disclosure: null });
  });

  it('P13 and P14 a time-only phrase is today while still ahead, else tomorrow', () => {
    expect(at('at 5pm')).toMatchObject({ date: '2026-10-08', time: '17:00' });
    expect(at('at 9am')).toMatchObject({ date: '2026-10-09', time: '09:00' });
  });

  it('P15 a bare hour needs am/pm', () => {
    const nine = only('tomorrow at 9');
    expect(resolve(nine)).toEqual({ status: 'needsChoice', missing: ['meridiem'] });
    expect(resolve(nine, { choices: { meridiem: 'am' } })).toMatchObject({ time: '09:00' });
    expect(resolve(nine, { choices: { meridiem: 'pm' } })).toMatchObject({ time: '21:00' });
    const twelve = only('at 12');
    expect(resolve(twelve)).toEqual({ status: 'needsChoice', missing: ['meridiem'] });
    expect(resolve(twelve, { choices: { meridiem: 'pm' } })).toMatchObject({ time: '12:00' });
    expect(resolve(twelve, { choices: { meridiem: 'am' } })).toMatchObject({ time: '00:00' });
  });

  it('P16 a leading zero or a 24-hour time needs no choice', () => {
    expect(at('tomorrow at 09:30').time).toBe('09:30');
    expect(at('at 17').time).toBe('17:00');
    expect(at('17:00').time).toBe('17:00');
  });

  it('P17 a range uses its start', () => {
    expect(at('Friday 3-5pm')).toMatchObject({ date: '2026-10-09', time: '15:00' });
  });

  it('P18-P21 durations: minutes and hours, floored to the minute, the same instant in every zone', () => {
    const table: Array<[string, string]> = [
      ['in 30 minutes', '13:30'],
      ['in an hour', '14:00'],
      ['in half an hour', '13:30'],
      ['in 2 hours and 30 minutes', '15:30'],
      ['within 2 hours', '15:00'],
      ['2 hours from now', '15:00'],
      ['in 2h', '15:00'],
    ];
    for (const [text, time] of table) expect({ text, time: at(text).time }).toEqual({ text, time });
    expect(at('in 2 hours', { ref: R + 40_000 }).utc).toBe('2026-10-08T09:00:00.000Z');
    expect(at('in 2 hours', { zone: NY })).toEqual({ date: '2026-10-08', time: '05:00', utc: '2026-10-08T09:00:00.000Z' });
    const fold = ready('in 2 hours', { zone: NY, ref: utc('2026-11-01T04:30:00Z') });
    expect(fold).toMatchObject({ date: '2026-11-01', time: '01:30', foldPreference: 'later', resolution: 'fold', instantUtc: utc('2026-11-01T06:30:00Z') });
  });

  it('P22 and P23 "in N days" is calendar arithmetic in the zone, not 24-hour steps', () => {
    const table: Array<[string, string]> = [
      ['in 3 days', '2026-10-11'],
      ['in 2 weeks', '2026-10-22'],
      ['in a week', '2026-10-15'],
      ['the day after tomorrow', '2026-10-10'],
    ];
    for (const [text, date] of table) expect({ text, ...at(text) }).toMatchObject({ text, date, time: '09:00' });
    expect(at('in 1 day', { zone: NY, ref: utc('2026-10-31T13:00:00Z') })).toEqual({ date: '2026-11-01', time: '09:00', utc: '2026-11-01T14:00:00.000Z' });
  });

  it('P24 yesterday is past', () => {
    expect(ready('yesterday')).toMatchObject({ date: '2026-10-07', time: '09:00', past: true });
  });

  it('P25 written dates with times', () => {
    expect(at('Oct 20 at 3:30pm').utc).toBe('2026-10-20T09:30:00.000Z');
    expect(at('2026-10-20 14:30').utc).toBe('2026-10-20T08:30:00.000Z');
    expect(at('12 Oct 2026 at 10am').utc).toBe('2026-10-12T04:00:00.000Z');
  });

  it('P26-P28 only a numeric date whose parts could both be months needs the order', () => {
    expect(ready('13/04')).toMatchObject({ date: '2026-04-13', time: '09:00', past: true, yearOmitted: true });
    expect(ready('04/04')).toMatchObject({ date: '2026-04-04', time: '09:00', past: true, yearOmitted: true });
    const withYear = only('03/04/2027');
    expect(resolve(withYear)).toEqual({ status: 'needsChoice', missing: ['order'] });
    expect(resolve(withYear, { choices: { order: 'swapped', useNextYear: true } })).toMatchObject({ date: '2027-04-03', yearOmitted: false });
    expect(at('10/20')).toMatchObject({ date: '2026-10-20', time: '09:00' });
  });

  it('P29 "May" only capitalized', () => {
    expect(ready('May 5')).toMatchObject({ date: '2026-05-05', past: true, yearOmitted: true });
    expect(candidates('may 5')).toEqual([]);
  });

  it('P30 and P31 zone abbreviations need an IANA choice; suggestions use the runtime zone list', () => {
    for (const text of ['at 5pm CST', '5pm EST tomorrow']) expect(resolve(only(text))).toEqual({ status: 'needsChoice', missing: ['zone'] });
    const est = only('5pm EST tomorrow');
    expect(est.zone).toEqual({ kind: 'abbreviation', abbr: 'EST', suggestions: ['America/New_York'] });
    expect(resolve(est, { choices: { zoneId: NY } })).toMatchObject({ status: 'ready', date: '2026-10-09', time: '17:00', instantUtc: utc('2026-10-09T21:00:00Z') });
    const ist = only('tomorrow 9am IST');
    const india = isKnownZone('Asia/Kolkata', null) ? 'Asia/Kolkata' : 'Asia/Calcutta';
    expect(ist.zone).toEqual({ kind: 'abbreviation', abbr: 'IST', suggestions: [india, 'Europe/Dublin', 'Asia/Jerusalem'] });
  });

  it('P32 UTC and GMT select UTC without a choice', () => {
    for (const text of ['5pm UTC', '5pm GMT']) {
      expect(only(text).zone).toEqual({ kind: 'fixed', zoneId: 'UTC' });
      expect(ready(text)).toMatchObject({ date: '2026-10-08', time: '17:00', instantUtc: utc('2026-10-08T17:00:00Z') });
    }
  });

  it('P33 several phrases in one text give separate candidates and titles', () => {
    const found = candidates('call Bob tomorrow at 9 and send report on Friday');
    expect(found.map((c) => [c.start, c.end, c.text, c.title])).toEqual([
      [9, 22, 'tomorrow at 9', 'call Bob and send report on Friday'],
      [39, 48, 'on Friday', 'call Bob tomorrow at 9 and send report'],
    ]);
    expect(resolve(found[0]!)).toEqual({ status: 'needsChoice', missing: ['meridiem'] });
    expect(resolve(found[1]!)).toMatchObject({ status: 'ready', date: '2026-10-09', time: '09:00' });
  });

  it('P34-P36 DST: the target date decides the offset, not the reference', () => {
    expect(ready('Nov 1 at 1:30am', { zone: NY })).toMatchObject({ resolution: 'fold', instantUtc: utc('2026-11-01T05:30:00Z') });
    expect(ready('Nov 1 at 1:30am', { zone: NY, choices: { fold: 'later' } }).instantUtc).toBe(utc('2026-11-01T06:30:00Z'));
    expect(ready('March 14, 2027 at 2:30am', { zone: NY })).toMatchObject({ resolution: 'gap', instantUtc: utc('2027-03-14T07:00:00Z') });
    const nov2 = ready('Nov 2 at 9am', { zone: NY });
    expect(nov2.instantUtc).toBe(utc('2026-11-02T14:00:00Z'));
    expect(nov2.instantUtc).not.toBe(utc('2026-11-02T13:00:00Z'));
  });

  it('P37 a time-only phrase near midnight counts today in the zone', () => {
    const ref = utc('2026-10-08T03:30:00Z');
    expect(at('at 9am', { zone: NY, ref })).toEqual({ date: '2026-10-08', time: '09:00', utc: '2026-10-08T13:00:00.000Z' });
    expect(at('at 9am', { zone: DHAKA, ref })).toEqual({ date: '2026-10-09', time: '09:00', utc: '2026-10-09T03:00:00.000Z' });
  });

  it('P38 weekdays from a Sunday reference', () => {
    const ref = utc('2026-10-11T04:00:00Z');
    const table: Array<[string, string, string]> = [
      ['Monday', '2026-10-12', '09:00'],
      ['next Monday', '2026-10-12', '09:00'],
      ['Sunday', '2026-10-18', '09:00'],
      ['Sunday at 5pm', '2026-10-11', '17:00'],
      ['next Sunday', '2026-10-18', '09:00'],
      ['last Sunday', '2026-10-04', '09:00'],
      ['this Sunday', '2026-10-18', '09:00'],
    ];
    for (const [text, date, time] of table) expect({ text, ...at(text, { ref }) }).toMatchObject({ text, date, time });
  });

  it('P39 unsupported text gives no candidate', () => {
    const unsupported = [
      'next week',
      'next month',
      'this weekend',
      'October',
      'in October',
      'in a second',
      'now',
      'on the 15th',
      'the sun is bright',
      'see you mon',
      "Let's do it sometime",
      'আগামীকাল বিকেল ৫টায়',
      'demain matin',
      'morgen früh',
    ];
    for (const text of unsupported) expect({ text, found: candidates(text) }).toEqual({ text, found: [] });
  });

  it('P40 known noise: "3/4 of the cake" is offered as a date that needs the order (stated limitation)', () => {
    expect(resolve(only('3/4 of the cake'))).toEqual({ status: 'needsChoice', missing: ['order'] });
  });

  it('a bare weekday never resolves to a past date; "last" always does', () => {
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      expect(ready(day).past, day).toBe(false);
      expect(ready(`last ${day}`).past, day).toBe(true);
    }
  });

  it('a candidate with no zone chosen asks for one, and phrases of several lines stay within their line', () => {
    expect(resolve(only('tomorrow'), { zone: '' })).toEqual({ status: 'needsChoice', missing: ['zone'] });
    const found = candidates('first line\nPay rent tomorrow\nOct 20');
    expect(found.map((c) => [c.start, c.end, c.text])).toEqual([
      [20, 28, 'tomorrow'],
      [29, 35, 'Oct 20'],
    ]);
  });
});

describe('PRODUCT_SPEC section 6 local and deterministic parsing (INF-NLP-01)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const inputs = ['Have to submit this by tomorrow end of the day', 'call Bob tomorrow at 9 and send report on Friday', 'in 2 hours', 'by 5 CST', 'next Monday', 'on Oct 1'];

  it('another system time and host zone give deep-equal results, and Date.now is never read', () => {
    const before = inputs.map((t) => candidates(t));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    vi.stubEnv('TZ', 'Pacific/Kiritimati');
    const now = vi.spyOn(Date, 'now');
    const after = inputs.map((t) => candidates(t));
    expect(after).toEqual(before);
    expect(now).not.toHaveBeenCalled();
  });
});
