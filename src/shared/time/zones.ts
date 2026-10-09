import { IANAZone } from 'luxon';

/** Coordinated Universal Time: the fixed zone of "5pm UTC" phrases (D-090) and the disclosed day fallback below. */
export const UTC_ZONE = 'UTC';

/**
 * Day boundaries of the reminder lists when neither the computer's zone nor a default zone is known. It is disclosed in
 * the views and never stored on a reminder (plan section 9.3).
 */
export const FALLBACK_DAY_ZONE = UTC_ZONE;

/** The computer's IANA zone as the JavaScript runtime reports it, or null when it is unknown. */
export function currentSystemZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && IANAZone.isValidZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

const cache = new Map<string, { list: string[]; set: ReadonlySet<string> }>();

function zoneIndex(system: string | null): { list: string[]; set: ReadonlySet<string> } {
  const key = system ?? '';
  let entry = cache.get(key);
  if (!entry) {
    const names = new Set(Intl.supportedValuesOf('timeZone'));
    // ICU leaves out UTC and may list the computer's zone only under an alias (Asia/Kolkata as Asia/Calcutta).
    names.add(FALLBACK_DAY_ZONE);
    if (system && IANAZone.isValidZone(system)) names.add(system);
    const list = [...names].sort();
    entry = { list, set: new Set(list) };
    cache.set(key, entry);
  }
  return entry;
}

/**
 * The zones a reminder may use (D-079): the runtime's IANA list plus UTC plus the computer's zone. Validation uses this
 * list, not Luxon validity, which also accepts abbreviations such as EST and CST.
 */
export function zoneList(system: string | null = currentSystemZone()): string[] {
  return zoneIndex(system).list;
}

export function isKnownZone(zoneId: string, system: string | null = currentSystemZone()): boolean {
  return zoneIndex(system).set.has(zoneId);
}

/** The zone a new reminder starts with: the setting, else the computer's zone; never a hard-coded zone (INF-REM-02). */
export function defaultZoneFor({ setting, system }: { setting: string | null; system: string | null }): string | null {
  return setting ?? system ?? null;
}

/** The city part of a zone for sentences ("New York" from America/New_York). */
export function zoneCity(zoneId: string): string {
  return (zoneId.split('/').pop() ?? zoneId).replace(/_/g, ' ');
}
