import { describe, expect, it } from 'vitest';
import { quietWindowAt, type QuietHours } from '../../src/shared/time/quiet-hours';

const at = (iso: string) => Date.parse(iso);
const night: QuietHours = { enabled: true, start: '22:00', end: '07:00', zoneId: 'Asia/Dhaka' };

describe('quiet hours (INF-SCHED-06)', () => {
  it('an overnight window in Asia/Dhaka: 23:00 and 06:59 are quiet until 07:00; 07:00 and 21:59 are not', () => {
    // 23:00 Dhaka on 2026-10-08 = 17:00Z; the window ends at 07:00 Dhaka on 2026-10-09 = 01:00Z.
    expect(quietWindowAt(at('2026-10-08T17:00:00Z'), night)).toEqual({ endUtc: at('2026-10-09T01:00:00Z') });
    expect(quietWindowAt(at('2026-10-09T00:59:00Z'), night)).toEqual({ endUtc: at('2026-10-09T01:00:00Z') });
    expect(quietWindowAt(at('2026-10-09T01:00:00Z'), night)).toBeNull();
    expect(quietWindowAt(at('2026-10-08T15:59:00Z'), night)).toBeNull();
    expect(quietWindowAt(at('2026-10-08T16:00:00Z'), night)).toEqual({ endUtc: at('2026-10-09T01:00:00Z') });
  });

  it('a same-day window 13:00 to 14:00', () => {
    const lunch: QuietHours = { enabled: true, start: '13:00', end: '14:00', zoneId: 'Asia/Dhaka' };
    expect(quietWindowAt(at('2026-10-08T07:00:00Z'), lunch)).toEqual({ endUtc: at('2026-10-08T08:00:00Z') });
    expect(quietWindowAt(at('2026-10-08T06:59:00Z'), lunch)).toBeNull();
    expect(quietWindowAt(at('2026-10-08T08:00:00Z'), lunch)).toBeNull();
  });

  it('a New York window ending at 01:30 on the fold day ends at the earlier 01:30', () => {
    const q: QuietHours = { enabled: true, start: '23:00', end: '01:30', zoneId: 'America/New_York' };
    // 23:30 EDT on 2026-10-31 = 03:30Z on 2026-11-01.
    expect(quietWindowAt(at('2026-11-01T03:30:00Z'), q)).toEqual({ endUtc: at('2026-11-01T05:30:00Z') });
    // During the repeated hour the earlier end has passed, so it is not quiet any more.
    expect(quietWindowAt(at('2026-11-01T06:15:00Z'), q)).toBeNull();
  });

  it('disabled or without a zone it is never quiet', () => {
    expect(quietWindowAt(at('2026-10-08T17:00:00Z'), { ...night, enabled: false })).toBeNull();
    expect(quietWindowAt(at('2026-10-08T17:00:00Z'), { ...night, zoneId: null })).toBeNull();
  });
});
