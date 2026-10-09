import { describe, expect, it } from 'vitest';
import { firstAfter, firstOnOrAfter, latestAtOrBefore, nextAfter, occurrenceInstant, type Series } from '../../src/shared/time/recurrence';
import { addDays } from '../../src/shared/time/resolve';

const NY = 'America/New_York';
const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString().replace('.000', '');
const daily = (time: string, startDate = '2026-01-01', fold: 'earlier' | 'later' = 'earlier'): Series => ({ rule: { freq: 'daily' }, startDate, time, zoneId: NY, fold });

describe('recurrence (INF-REM-12, D-078)', () => {
  it('daily 09:00 New York keeps the wall-clock time across both DST changes (planner probe instants)', () => {
    const s = daily('09:00');
    const dates = ['2026-03-07', '2026-03-08', '2026-03-09', '2026-10-31', '2026-11-01', '2026-11-02'];
    expect(dates.map((d) => iso(occurrenceInstant(s, d)))).toEqual([
      '2026-03-07T14:00:00Z',
      '2026-03-08T13:00:00Z',
      '2026-03-09T13:00:00Z',
      '2026-10-31T13:00:00Z',
      '2026-11-01T14:00:00Z',
      '2026-11-02T14:00:00Z',
    ]);
  });

  it('daily 02:30 New York: the gap day uses 03:00 EDT for that day only', () => {
    const s = daily('02:30');
    expect(['2026-03-07', '2026-03-08', '2026-03-09'].map((d) => iso(occurrenceInstant(s, d)))).toEqual([
      '2026-03-07T07:30:00Z',
      '2026-03-08T07:00:00Z',
      '2026-03-09T06:30:00Z',
    ]);
  });

  it('daily 01:30 New York on the fold day gives exactly one instant, by preference', () => {
    const earlier = daily('01:30');
    const later = daily('01:30', '2026-01-01', 'later');
    expect(iso(occurrenceInstant(earlier, '2026-11-01'))).toBe('2026-11-01T05:30:00Z');
    expect(iso(occurrenceInstant(later, '2026-11-01'))).toBe('2026-11-01T06:30:00Z');
    // Walking the series across the fold never yields both instants.
    const seen: string[] = [];
    let t = at('2026-10-31T12:00:00Z');
    for (let i = 0; i < 3; i += 1) {
      const next = firstAfter(earlier, t);
      seen.push(iso(next.instantUtc));
      t = next.instantUtc;
    }
    expect(seen).toEqual(['2026-11-01T05:30:00Z', '2026-11-02T06:30:00Z', '2026-11-03T06:30:00Z']);
  });

  it('weekly Mon/Wed/Fri from Thursday 2026-10-08: Fri 9, Mon 12, Wed 14', () => {
    const rule = { freq: 'weekly' as const, byWeekday: [1, 3, 5] };
    const first = firstOnOrAfter(rule, '2026-10-08', '2026-10-08');
    const second = nextAfter(rule, first);
    const third = nextAfter(rule, second);
    expect([first, second, third]).toEqual(['2026-10-09', '2026-10-12', '2026-10-14']);
    expect(firstOnOrAfter(rule, '2026-10-08', '2026-10-01')).toBe('2026-10-09');
  });

  it('latestAtOrBefore after 400 days looks back at most one week of dates and respects the start date', () => {
    const s = daily('09:00', '2026-10-08');
    const later = at('2026-10-08T13:00:00Z') + 400 * 86_400_000 + 3_600_000;
    const latest = latestAtOrBefore(s, later)!;
    expect(latest.date).toBe(addDays('2026-10-08', 400));
    expect(latest.instantUtc).toBeLessThanOrEqual(later);
    // Before 09:00 on the start date there is no occurrence yet.
    expect(latestAtOrBefore(s, at('2026-10-08T12:59:00Z'))).toBeNull();
    // A weekly series whose only weekday is 7 days back is still found; anything older is not searched.
    const weekly: Series = { rule: { freq: 'weekly', byWeekday: [4] }, startDate: '2026-01-01', time: '09:00', zoneId: NY, fold: 'earlier' };
    expect(latestAtOrBefore(weekly, at('2026-10-15T12:00:00Z'))!.date).toBe('2026-10-08');
  });

  it('firstAfter skips today when today’s time has passed', () => {
    const s = daily('09:00', '2026-10-01');
    expect(firstAfter(s, at('2026-10-08T12:59:00Z'))).toEqual({ date: '2026-10-08', instantUtc: at('2026-10-08T13:00:00Z') });
    expect(firstAfter(s, at('2026-10-08T13:00:00Z'))).toEqual({ date: '2026-10-09', instantUtc: at('2026-10-09T13:00:00Z') });
  });
});
