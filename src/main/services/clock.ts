export interface Clock {
  /** Wall-clock time in epoch milliseconds. */
  now(): number;
  /** Monotonic milliseconds for durations. */
  monotonicNow(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  monotonicNow: () => Number(process.hrtime.bigint() / 1_000_000n),
};
