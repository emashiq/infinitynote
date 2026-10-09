import { describe, expect, it } from 'vitest';
import { dueLines, formatInZone, formatShort } from '../../src/shared/time/format';

const due = Date.parse('2026-10-09T11:00:00Z');

describe('due time formatting (INF-REM-03)', () => {
  it('shows the reminder zone and, when the wall clock differs, the computer time', () => {
    expect(dueLines(due, 'Asia/Dhaka', 'America/New_York')).toEqual({
      primary: 'Fri 9 Oct 2026, 17:00 · Asia/Dhaka',
      local: 'Your time: Fri 9 Oct 2026, 07:00 · America/New_York',
    });
  });

  it('no local line in the same zone, in another zone with the same wall clock, or without a display zone', () => {
    expect(dueLines(due, 'Asia/Dhaka', 'Asia/Dhaka').local).toBeNull();
    expect(dueLines(due, 'Asia/Dhaka', 'Asia/Thimphu').local).toBeNull();
    expect(dueLines(due, 'Asia/Dhaka', null)).toEqual({ primary: 'Fri 9 Oct 2026, 17:00 · Asia/Dhaka', local: null });
  });

  it('a display zone across midnight shows the previous date', () => {
    expect(dueLines(Date.parse('2026-10-09T03:00:00Z'), 'Asia/Dhaka', 'Pacific/Honolulu').local).toBe('Your time: Thu 8 Oct 2026, 17:00 · Pacific/Honolulu');
  });

  it('full and short forms', () => {
    expect(formatInZone(due, 'Asia/Dhaka')).toBe('Fri 9 Oct 2026, 17:00');
    expect(formatShort(due, 'Asia/Dhaka')).toBe('Fri 9 Oct, 17:00');
    expect(formatShort(due, 'America/New_York')).toBe('Fri 9 Oct, 07:00');
  });
});
