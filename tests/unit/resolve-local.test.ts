import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { foldNotice, gapNotice, laterChoiceLabel } from '../../src/shared/time/format';
import { addDays, isValidLocalDate, isValidLocalTime, isoWeekday, localParts, resolveLocal } from '../../src/shared/time/resolve';

const NY = 'America/New_York';
const at = (iso: string) => Date.parse(iso);

describe('resolveLocal (INF-REM-14, D-079)', () => {
  it('2026-03-08 02:30 New York is in the spring gap: first valid instant 03:00 EDT, with the gap notice', () => {
    const r = resolveLocal({ date: '2026-03-08', time: '02:30' }, NY);
    expect(r).toEqual({ status: 'gap', instantUtc: at('2026-03-08T07:00:00Z') });
    expect(gapNotice('02:30', NY, r.instantUtc)).toBe('02:30 does not exist on this date in New York; the reminder will use 03:00');
    // Luxon's own default would move a gap time forward by the gap length (03:30), which the app does not use.
    const luxonDefault = DateTime.fromObject({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, { zone: NY }).toMillis();
    expect(luxonDefault).toBe(at('2026-03-08T07:30:00Z'));
    expect(r.instantUtc).not.toBe(luxonDefault);
  });

  it('2026-11-01 01:30 New York happens twice: earlier by default, later on request, both alternatives', () => {
    const earlier = resolveLocal({ date: '2026-11-01', time: '01:30' }, NY);
    const later = resolveLocal({ date: '2026-11-01', time: '01:30' }, NY, 'later');
    const both: [number, number] = [at('2026-11-01T05:30:00Z'), at('2026-11-01T06:30:00Z')];
    expect(earlier).toEqual({ status: 'fold', instantUtc: both[0], alternatives: both });
    expect(later).toEqual({ status: 'fold', instantUtc: both[1], alternatives: both });
    expect(foldNotice('01:30', 'earlier')).toBe('01:30 happens twice on this date; using the earlier one');
    expect(foldNotice('01:30', 'later')).toBe('01:30 happens twice on this date; using the later one');
    expect(laterChoiceLabel(both[1], NY)).toBe('Use the later one (EST)');
  });

  it('ordinary times, 30-minute DST (Lord Howe) and a 45-minute offset (Kathmandu)', () => {
    expect(resolveLocal({ date: '2026-10-09', time: '17:00' }, 'Asia/Dhaka')).toEqual({ status: 'ok', instantUtc: at('2026-10-09T11:00:00Z') });
    expect(resolveLocal({ date: '2026-10-04', time: '02:15' }, 'Australia/Lord_Howe')).toEqual({ status: 'gap', instantUtc: at('2026-10-03T15:30:00Z') });
    expect(resolveLocal({ date: '2026-10-09', time: '09:00' }, 'Asia/Kathmandu')).toEqual({ status: 'ok', instantUtc: at('2026-10-09T03:15:00Z') });
    expect(resolveLocal({ date: '2026-10-09', time: '09:00' }, 'UTC')).toEqual({ status: 'ok', instantUtc: at('2026-10-09T09:00:00Z') });
  });

  it('throws RangeError for invalid input', () => {
    expect(() => resolveLocal({ date: '2026-02-30', time: '09:00' }, NY)).toThrow(RangeError);
    expect(() => resolveLocal({ date: '2026-10-09', time: '24:00' }, NY)).toThrow(RangeError);
    expect(() => resolveLocal({ date: '2026-10-09', time: '09:00' }, 'Mars/Base')).toThrow(RangeError);
  });

  it('local parts and calendar helpers', () => {
    expect(localParts(at('2026-10-08T03:30:00Z'), NY)).toEqual({ date: '2026-10-07', time: '23:30' });
    expect(localParts(at('2026-10-08T03:30:00Z'), 'Asia/Dhaka')).toEqual({ date: '2026-10-08', time: '09:30' });
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(isoWeekday('2026-10-08')).toBe(4);
    expect(isoWeekday('2026-10-11')).toBe(7);
    expect(isValidLocalDate('2028-02-29')).toBe(true);
    expect(isValidLocalDate('2026-02-29')).toBe(false);
    expect(isValidLocalDate('1999-12-31')).toBe(false);
    expect(isValidLocalDate('2101-01-01')).toBe(false);
    expect(isValidLocalDate('2026-1-01')).toBe(false);
    expect(isValidLocalTime('00:00')).toBe(true);
    expect(isValidLocalTime('23:59')).toBe(true);
    expect(isValidLocalTime('7:00')).toBe(false);
    expect(isValidLocalTime('12:60')).toBe(false);
  });
});
