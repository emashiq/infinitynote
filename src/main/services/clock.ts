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

/**
 * A frozen clock a test moves (D-084): `advance` moves wall and monotonic time, `jump` only the wall clock, and `set`
 * moves forward like elapsed time (backward only the wall clock, as monotonic time never decreases).
 */
export interface FakeClock extends Clock {
  set(wallMs: number): void;
  advance(ms: number): void;
  jump(ms: number): void;
}

export function createFakeClock(startMs: number): FakeClock {
  let wall = startMs;
  let mono = 0;
  return {
    now: () => wall,
    monotonicNow: () => mono,
    set(wallMs) {
      mono += Math.max(0, wallMs - wall);
      wall = wallMs;
    },
    advance(ms) {
      wall += ms;
      mono += ms;
    },
    jump(ms) {
      wall += ms;
    },
  };
}
