import { describe, expect, it } from 'vitest';
import { formatRelative } from '../../src/shared/time/relative-time';

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelative', () => {
  it('says just now under 45 seconds, and for times in the future', () => {
    expect(formatRelative(NOW, NOW)).toBe('just now');
    expect(formatRelative(NOW - 44_000, NOW)).toBe('just now');
    expect(formatRelative(NOW + 5 * MIN, NOW)).toBe('just now');
  });

  it('formats minutes, hours and days', () => {
    expect(formatRelative(NOW - 45_000, NOW)).toBe('1 minute ago');
    expect(formatRelative(NOW - 5 * MIN, NOW)).toBe('5 minutes ago');
    expect(formatRelative(NOW - 3 * HOUR, NOW)).toBe('3 hours ago');
    expect(formatRelative(NOW - DAY, NOW)).toBe('yesterday');
    expect(formatRelative(NOW - 3 * DAY, NOW)).toBe('3 days ago');
  });

  it('uses a medium date after 7 days', () => {
    expect(formatRelative(NOW - 7 * DAY, NOW)).toBe('7 days ago');
    const text = formatRelative(NOW - 8 * DAY, NOW);
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/Sep/);
  });
});
