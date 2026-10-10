import type { Timers } from '../state/store';

/** At most one activity report per this many milliseconds (the shortest blur setting is 30 s; D-172, D-185). */
export const ACTIVITY_REPORT_MS = 5_000;

export interface ActivityReporter {
  /** Interaction happened (a key, click, scroll or pointer move in a revealed sticky or an unlocked document). */
  report(): void;
  dispose(): void;
}

/**
 * Throttles interaction reports to main (a revealed locked sticky, D-172; an unlocked locked document, D-185): the first
 * one goes at once, later ones within the interval are folded into one sent when it ends. Main owns the blur and idle
 * timers; this only keeps the IPC rate low.
 */
export function createActivityReporter(send: () => void, deps: { timers: Timers; now: () => number; intervalMs?: number }): ActivityReporter {
  const interval = deps.intervalMs ?? ACTIVITY_REPORT_MS;
  let last = Number.NEGATIVE_INFINITY;
  let pending: unknown = null;
  const fire = () => {
    pending = null;
    last = deps.now();
    send();
  };
  return {
    report() {
      if (pending !== null) return;
      const wait = last + interval - deps.now();
      if (wait <= 0) fire();
      else pending = deps.timers.setTimeout(fire, wait);
    },
    dispose() {
      if (pending !== null) deps.timers.clearTimeout(pending);
      pending = null;
    },
  };
}
