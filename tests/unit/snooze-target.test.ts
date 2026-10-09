import { describe, expect, it } from 'vitest';
import { SNOOZE_LABELS, SNOOZE_PRESETS, snoozeTarget } from '../../src/shared/time/snooze';

const at = (iso: string) => Date.parse(iso);

describe('snooze targets (INF-REM-10, D-078)', () => {
  it('minute presets are instant arithmetic, also across the fold (01:30 EDT + 60 min = 06:30Z)', () => {
    const now = at('2026-11-01T05:30:00Z');
    expect(snoozeTarget(60, now, 'America/New_York')).toBe(at('2026-11-01T06:30:00Z'));
    expect(snoozeTarget(5, now, 'America/New_York')).toBe(now + 5 * 60_000);
  });

  it('Tomorrow 09:00 is the next calendar day in the reminder zone', () => {
    // 2026-10-08T03:30Z is still 7 October in New York and already 8 October in Dhaka.
    const now = at('2026-10-08T03:30:00Z');
    expect(snoozeTarget('tomorrow', now, 'America/New_York')).toBe(at('2026-10-08T13:00:00Z'));
    expect(snoozeTarget('tomorrow', now, 'Asia/Dhaka')).toBe(at('2026-10-09T03:00:00Z'));
  });

  it('every preset has its menu label', () => {
    expect(SNOOZE_PRESETS.map((p) => SNOOZE_LABELS[p])).toEqual(['5 minutes', '10 minutes', '15 minutes', '30 minutes', '1 hour', 'Tomorrow 09:00']);
  });
});
