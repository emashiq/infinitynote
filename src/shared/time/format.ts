import { DateTime } from 'luxon';
import { localParts, type FoldPreference } from './resolve';
import { zoneCity } from './zones';

const at = (instant: number, zoneId: string) => DateTime.fromMillis(instant, { zone: zoneId, locale: 'en-US' });

/** "Fri 9 Oct 2026, 17:00" on the wall clock of a zone. */
export function formatInZone(instant: number, zoneId: string): string {
  return at(instant, zoneId).toFormat('ccc d LLL yyyy, HH:mm');
}

/** "Fri 9 Oct, 17:00" on the wall clock of a zone. */
export function formatShort(instant: number, zoneId: string): string {
  return at(instant, zoneId).toFormat('ccc d LLL, HH:mm');
}

/** The short name of a zone's offset at an instant ("EST", or "GMT+6" where the zone has no abbreviation). */
export function zoneAbbreviation(instant: number, zoneId: string): string {
  return at(instant, zoneId).toFormat('ZZZZ');
}

export interface DueLines {
  /** "Fri 9 Oct 2026, 17:00 · Asia/Dhaka" in the reminder's zone. */
  primary: string;
  /** "Your time: … · <display zone>" when the computer's wall clock reads differently, else null (INF-REM-03). */
  local: string | null;
}

export function dueLines(instant: number, zoneId: string, displayZone: string | null): DueLines {
  const primaryText = formatInZone(instant, zoneId);
  const localText = displayZone ? formatInZone(instant, displayZone) : primaryText;
  return {
    primary: `${primaryText} · ${zoneId}`,
    local: displayZone && localText !== primaryText ? `Your time: ${localText} · ${displayZone}` : null,
  };
}

/** "02:30 does not exist on this date in New York; the reminder will use 03:00" (INF-REM-14). */
export function gapNotice(requestedTime: string, zoneId: string, resolvedInstant: number): string {
  return `${requestedTime} does not exist on this date in ${zoneCity(zoneId)}; the reminder will use ${localParts(resolvedInstant, zoneId).time}`;
}

/** "01:30 happens twice on this date; using the earlier one" (INF-REM-14). */
export function foldNotice(requestedTime: string, preference: FoldPreference): string {
  return `${requestedTime} happens twice on this date; using the ${preference} one`;
}

/** The label of the fold choice: "Use the later one (EST)". */
export function laterChoiceLabel(laterInstant: number, zoneId: string): string {
  return `Use the later one (${zoneAbbreviation(laterInstant, zoneId)})`;
}
