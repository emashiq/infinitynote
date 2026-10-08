/** Automatic version scaffolding (D-056). Phase 08 makes these configurable. */
export const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;
export const AUTO_VERSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTO_VERSION_MAX_COUNT = 100;

export interface AutoVersionRow {
  id: string;
  createdAt: number;
}

/** IDs of a note's automatic versions to delete: older than 30 days, or beyond the newest 100. */
export function selectAutoVersionsToPrune(rows: readonly AutoVersionRow[], now: number): string[] {
  const newestFirst = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  return newestFirst.filter((row, index) => index >= AUTO_VERSION_MAX_COUNT || row.createdAt < now - AUTO_VERSION_MAX_AGE_MS).map((r) => r.id);
}
