/** Failures accepted before each further attempt waits (1 s, 2 s, 4 s ... up to MAX_BACKOFF_S; D-111). */
const FREE_ATTEMPTS = 3;
const MAX_BACKOFF_S = 30;

interface Failures {
  count: number;
  /** Epoch ms before which no attempt is accepted. */
  until: number;
}

/**
 * Wrong secrets in a row per key (a note), in memory only: three free attempts, then a growing wait between attempts.
 * Shared by password and PIN attempts so both slow down the same way (D-111, D-173).
 */
export class AttemptBackoff {
  private readonly failures = new Map<string, Failures>();

  constructor(private readonly now: () => number) {}

  record(key: string): void {
    const count = this.count(key) + 1;
    const delay = count < FREE_ATTEMPTS ? 0 : Math.min(MAX_BACKOFF_S, 2 ** (count - FREE_ATTEMPTS));
    this.failures.set(key, { count, until: this.now() + delay * 1000 });
  }

  clear(key: string): void {
    this.failures.delete(key);
  }

  count(key: string): number {
    return this.failures.get(key)?.count ?? 0;
  }

  retryInSeconds(key: string): number {
    const until = this.failures.get(key)?.until ?? 0;
    return Math.max(0, Math.ceil((until - this.now()) / 1000));
  }
}

/** Runs attempts per key in order: each starts after the previous one settled, so parallel requests meet the same waits. */
export class SerialAttempts {
  private readonly last = new Map<string, Promise<void>>();

  run<T>(key: string, attempt: () => Promise<T>): Promise<T> {
    const previous = this.last.get(key) ?? Promise.resolve();
    const result = previous.then(attempt);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.last.set(key, settled);
    void settled.then(() => {
      if (this.last.get(key) === settled) this.last.delete(key);
    });
    return result;
  }
}
