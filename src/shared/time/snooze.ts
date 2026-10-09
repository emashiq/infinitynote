import { addDays, localParts, resolveLocal } from './resolve';

/** Snooze choices (D-078): minutes are instant arithmetic, `tomorrow` is 09:00 on the next calendar day. */
export const SNOOZE_PRESETS = [5, 10, 15, 30, 60, 'tomorrow'] as const;
export type SnoozePresetValue = (typeof SNOOZE_PRESETS)[number];

export const SNOOZE_TOMORROW_TIME = '09:00';

export const SNOOZE_LABELS: Record<SnoozePresetValue, string> = {
  5: '5 minutes',
  10: '10 minutes',
  15: '15 minutes',
  30: '30 minutes',
  60: '1 hour',
  tomorrow: 'Tomorrow 09:00',
};

/** When a snoozed occurrence alerts again; `tomorrow` is calendar arithmetic in the reminder's own zone. */
export function snoozeTarget(preset: SnoozePresetValue, now: number, zoneId: string): number {
  if (preset !== 'tomorrow') return now + preset * 60_000;
  const tomorrow = addDays(localParts(now, zoneId).date, 1);
  return resolveLocal({ date: tomorrow, time: SNOOZE_TOMORROW_TIME }, zoneId, 'earlier').instantUtc;
}
