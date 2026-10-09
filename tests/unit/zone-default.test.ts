import { describe, expect, it } from 'vitest';
import { currentSystemZone, defaultZoneFor, FALLBACK_DAY_ZONE, isKnownZone, zoneCity, zoneList } from '../../src/shared/time/zones';

describe('zones (INF-REM-02, D-079)', () => {
  it('the default zone is the setting, else the computer zone, never a hard-coded one', () => {
    expect(defaultZoneFor({ setting: null, system: 'America/New_York' })).toBe('America/New_York');
    expect(defaultZoneFor({ setting: 'Asia/Dhaka', system: 'America/New_York' })).toBe('Asia/Dhaka');
    expect(defaultZoneFor({ setting: null, system: null })).toBeNull();
  });

  it('the list is the runtime IANA list plus UTC plus the computer zone, sorted and unique', () => {
    const list = zoneList(null);
    expect(list).toContain('Asia/Dhaka');
    expect(list).toContain('America/New_York');
    expect(list).toContain(FALLBACK_DAY_ZONE);
    expect([...list].sort()).toEqual(list);
    expect(new Set(list).size).toBe(list.length);
    expect(list.length).toBeGreaterThan(300);
    expect(list.length).toBeLessThanOrEqual(700);
  });

  it('a computer zone that ICU lists only under an alias is added to the list', () => {
    const runtime = new Set(Intl.supportedValuesOf('timeZone'));
    // The planner probe saw ICU list Asia/Calcutta but not the canonical Asia/Kolkata a computer may report.
    const alias = ['Asia/Kolkata', 'US/Eastern'].find((z) => !runtime.has(z));
    expect(alias).toBeDefined();
    expect(zoneList(null)).not.toContain(alias);
    expect(zoneList(alias!)).toContain(alias);
    expect(isKnownZone(alias!, alias!)).toBe(true);
    expect(isKnownZone(alias!, null)).toBe(false);
  });

  it('membership comes from the list, not Luxon validity: EST, CST and invented names are refused', () => {
    expect(isKnownZone('Asia/Calcutta', null) || isKnownZone('Asia/Kolkata', null)).toBe(true);
    expect(isKnownZone('UTC', null)).toBe(true);
    expect(isKnownZone('EST', null)).toBe(false);
    expect(isKnownZone('CST', null)).toBe(false);
    expect(isKnownZone('Mars/Base', null)).toBe(false);
  });

  it('the runtime reports a known computer zone', () => {
    const zone = currentSystemZone();
    expect(zone).not.toBeNull();
    expect(isKnownZone(zone!)).toBe(true);
  });

  it('city names for sentences', () => {
    expect(zoneCity('America/New_York')).toBe('New York');
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(zoneCity('UTC')).toBe('UTC');
  });
});
