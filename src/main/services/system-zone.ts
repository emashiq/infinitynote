import { currentSystemZone } from '../../shared/time/zones';

/**
 * The computer's IANA zone, read on every scheduler wake and every reminder query (D-079). Electron's main process may
 * only see an OS zone change after a restart; tests replace the provider instead of changing the host's zone.
 */
export interface SystemZoneProvider {
  current(): string | null;
}

export const intlZoneProvider: SystemZoneProvider = { current: currentSystemZone };

/** A provider whose zone a test sets (INFINITY_NOTES_TEST_ZONE and the zone hook, D-084). */
export function createFixedZoneProvider(zone: string | null): SystemZoneProvider & { set(zone: string | null): void } {
  let value = zone;
  return {
    current: () => value,
    set: (next) => {
      value = next;
    },
  };
}
