import { describe, expect, it } from 'vitest';
import { Followup } from '../../src/shared/contracts/reminders';
import { SETTINGS, SettingsSetRequest } from '../../src/shared/contracts/settings';

describe('follow-up presets and default (INF-REM-11)', () => {
  it('accepts the interval presets 5/10/15/30/60 and the limits 1/2/3/5 only', () => {
    for (const intervalMinutes of [5, 10, 15, 30, 60]) {
      for (const maxFollowups of [1, 2, 3, 5]) expect(Followup.safeParse({ intervalMinutes, maxFollowups }).success).toBe(true);
    }
    for (const intervalMinutes of [7, 0, 4, 6, 120]) expect(Followup.safeParse({ intervalMinutes, maxFollowups: 2 }).success, String(intervalMinutes)).toBe(false);
    for (const maxFollowups of [0, 4, 6]) expect(Followup.safeParse({ intervalMinutes: 15, maxFollowups }).success, String(maxFollowups)).toBe(false);
    expect(Followup.safeParse(null).success).toBe(true);
    expect(Followup.safeParse({ intervalMinutes: 15, maxFollowups: 2, extra: 1 }).success).toBe(false);
  });

  it('the setting is off by default with 15 minutes twice ready for when it is switched on', () => {
    expect(SETTINGS['reminders.followupDefault']).toMatchObject({ default: { enabled: false, intervalMinutes: 15, maxFollowups: 2 }, public: true });
    expect(SettingsSetRequest.safeParse({ key: 'reminders.followupDefault', value: { enabled: true, intervalMinutes: 30, maxFollowups: 5 } }).success).toBe(true);
    expect(SettingsSetRequest.safeParse({ key: 'reminders.followupDefault', value: { enabled: true, intervalMinutes: 7, maxFollowups: 2 } }).success).toBe(false);
  });
});
