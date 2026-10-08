import { describe, expect, it } from 'vitest';
import { AUTO_VERSION_MAX_AGE_MS, AUTO_VERSION_MAX_COUNT, selectAutoVersionsToPrune } from '../../src/shared/versions/retention';

const NOW = 1_800_000_000_000;

describe('selectAutoVersionsToPrune (D-056)', () => {
  it('keeps everything within 30 days and the newest 100', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `v${i}`, createdAt: NOW - i * 1000 }));
    expect(selectAutoVersionsToPrune(rows, NOW)).toEqual([]);
  });

  it('prunes versions older than 30 days', () => {
    const rows = [
      { id: 'fresh', createdAt: NOW - 1000 },
      { id: 'edge', createdAt: NOW - AUTO_VERSION_MAX_AGE_MS },
      { id: 'old', createdAt: NOW - AUTO_VERSION_MAX_AGE_MS - 1 },
    ];
    expect(selectAutoVersionsToPrune(rows, NOW)).toEqual(['old']);
  });

  it('prunes beyond the newest 100 regardless of input order', () => {
    const rows = Array.from({ length: AUTO_VERSION_MAX_COUNT + 3 }, (_, i) => ({ id: `v${i}`, createdAt: NOW - i * 60_000 })).reverse();
    expect(selectAutoVersionsToPrune(rows, NOW).sort()).toEqual(['v100', 'v101', 'v102']);
  });
});
