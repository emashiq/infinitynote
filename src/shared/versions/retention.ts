/** Automatic version retention (D-056, D-034); the age and count are settings from Phase 08 (INF-PORT-07). */
export const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_AUTO_VERSION_DAYS = 30;
export const AUTO_VERSION_DAYS_RANGE = { min: 1, max: 365 } as const;
export const DEFAULT_AUTO_VERSION_MAX = 100;
export const AUTO_VERSION_MAX_RANGE = { min: 10, max: 1000 } as const;

export const AUTO_VERSION_MAX_AGE_MS = DEFAULT_AUTO_VERSION_DAYS * DAY_MS;
export const AUTO_VERSION_MAX_COUNT = DEFAULT_AUTO_VERSION_MAX;

export interface AutoVersionPolicy {
  maxAgeDays: number;
  maxCount: number;
}

export const DEFAULT_AUTO_VERSION_POLICY: AutoVersionPolicy = { maxAgeDays: DEFAULT_AUTO_VERSION_DAYS, maxCount: DEFAULT_AUTO_VERSION_MAX };

export interface AutoVersionRow {
  id: string;
  createdAt: number;
}

/** IDs of a note's automatic versions to delete: older than the policy's age, or beyond its newest `maxCount`. */
export function selectAutoVersionsToPrune(rows: readonly AutoVersionRow[], now: number, policy: AutoVersionPolicy = DEFAULT_AUTO_VERSION_POLICY): string[] {
  const newestFirst = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  const oldest = now - policy.maxAgeDays * DAY_MS;
  return newestFirst.filter((row, index) => index >= policy.maxCount || row.createdAt < oldest).map((r) => r.id);
}
