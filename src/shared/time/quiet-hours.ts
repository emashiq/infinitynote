import { IANAZone } from 'luxon';
import { addDays, localParts, resolveLocal } from './resolve';

export interface QuietHours {
  enabled: boolean;
  /** `HH:mm` on the wall clock of `zoneId`. */
  start: string;
  end: string;
  zoneId: string | null;
}

/**
 * Whether an instant falls in the quiet-hours window and, if so, the instant it ends (plan section 9.4). A same-day
 * window (start before end) is quiet from start up to end; an overnight window from start to the next day's end.
 * The end on a DST change resolves like any wall-clock time (a gap moves to the first valid minute).
 */
export function quietWindowAt(instant: number, q: QuietHours): { endUtc: number } | null {
  if (!q.enabled || q.zoneId === null || q.start === q.end || !IANAZone.isValidZone(q.zoneId)) return null;
  const { date, time } = localParts(instant, q.zoneId);
  // In the repeated hour of a fold the earlier end can already be past: the window is over then.
  const endOn = (day: string) => {
    const endUtc = resolveLocal({ date: day, time: q.end }, q.zoneId!, 'earlier').instantUtc;
    return endUtc > instant ? { endUtc } : null;
  };
  if (q.start < q.end) return time >= q.start && time < q.end ? endOn(date) : null;
  if (time >= q.start) return endOn(addDays(date, 1));
  if (time < q.end) return endOn(date);
  return null;
}
