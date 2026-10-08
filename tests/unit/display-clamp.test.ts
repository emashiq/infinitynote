import { describe, expect, it } from 'vitest';
import { computeStickyBounds, displayFor, isReachable, type DisplayInfo } from '../../src/main/windows/display-clamp';

const d = (id: number, x: number, width = 1920, height = 1080): DisplayInfo => ({
  id,
  bounds: { x, y: 0, width, height },
  workArea: { x, y: 0, width, height: height - 40 },
});
const D1 = d(1, 0);
const D2 = d(2, 1920);
const LEFT = d(3, -1920);
const base = { displayHint: null, primaryId: 1, positioning: 'supported' as const, cascadeIndex: 0 };

describe('computeStickyBounds (INF-STKY-06, D-068)', () => {
  it('keeps a window that lies inside a work area unchanged', () => {
    const stored = { x: 100, y: 200, width: 320, height: 300 };
    expect(computeStickyBounds({ ...base, stored, displays: [D1, D2] })).toEqual({ ...stored, displayId: 1 });
    const onTwo = { x: 2400, y: 50, width: 400, height: 500 };
    expect(computeStickyBounds({ ...base, stored: onTwo, displays: [D1, D2] })).toEqual({ ...onTwo, displayId: 2 });
  });

  it('shifts a window that is partly off the right edge fully inside', () => {
    const stored = { x: 1800, y: 900, width: 320, height: 300 };
    expect(computeStickyBounds({ ...base, stored, displays: [D1] })).toEqual({ x: 1600, y: 740, width: 320, height: 300, displayId: 1 });
  });

  it('a window on a removed display with its hint gone is centered on the primary display with the cascade', () => {
    const stored = { x: 2400, y: 100, width: 320, height: 300 };
    const placed = computeStickyBounds({ ...base, stored, displayHint: 2, displays: [D1], cascadeIndex: 1 });
    expect(placed).toEqual({ x: Math.round((1920 - 320) / 2 + 24), y: Math.round((1040 - 300) / 2 + 24), width: 320, height: 300, displayId: 1 });
  });

  it('an unreachable window moves onto its hint display while that is connected', () => {
    const stored = { x: 9000, y: 9000, width: 320, height: 300 };
    const placed = computeStickyBounds({ ...base, stored, displayHint: 2, displays: [D1, D2] });
    expect(placed.displayId).toBe(2);
    expect(placed).toEqual({ x: 1920 + 800, y: 370, width: 320, height: 300, displayId: 2 });
  });

  it('shrinks a window larger than the work area and keeps the 220x120 minimum', () => {
    const small = d(4, 0, 800, 600);
    expect(computeStickyBounds({ ...base, primaryId: 4, stored: { x: 0, y: 0, width: 5000, height: 4000 }, displays: [small] })).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 560,
      displayId: 4,
    });
    expect(computeStickyBounds({ ...base, stored: { x: 10, y: 10, width: 100, height: 40 }, displays: [D1] })).toEqual({
      x: 10,
      y: 10,
      width: 220,
      height: 120,
      displayId: 1,
    });
  });

  it('keeps the negative coordinates of a monitor left of the primary', () => {
    const stored = { x: -1500, y: 300, width: 320, height: 300 };
    expect(computeStickyBounds({ ...base, stored, displays: [D1, LEFT] })).toEqual({ ...stored, displayId: 3 });
  });

  it('gives the size only where positioning is unsupported or the stored position is null', () => {
    const stored = { x: 100, y: 100, width: 400, height: 350 };
    expect(computeStickyBounds({ ...base, positioning: 'unsupported', stored, displays: [D1] })).toEqual({ width: 400, height: 350 });
    expect(computeStickyBounds({ ...base, positioning: 'unsupported', stored: null, displays: [D1] })).toEqual({ width: 320, height: 300 });
    expect(computeStickyBounds({ ...base, stored: { x: null, y: null, width: 400, height: 350 }, displays: [D1] })).toEqual({ width: 400, height: 350 });
  });

  it('places a new window at the top right of the primary work area, cascading by 24 px', () => {
    expect(computeStickyBounds({ ...base, stored: null, displays: [D2, D1] })).toEqual({ x: 1920 - 320 - 32, y: 32, width: 320, height: 300, displayId: 1 });
    expect(computeStickyBounds({ ...base, stored: null, displays: [D1], cascadeIndex: 9 })).toEqual({ x: 1920 - 320 - 32 - 24, y: 56, width: 320, height: 300, displayId: 1 });
  });

  it('treats unknown positioning like supported', () => {
    const stored = { x: 100, y: 200, width: 320, height: 300 };
    expect(computeStickyBounds({ ...base, positioning: 'unknown', stored, displays: [D1] })).toEqual({ ...stored, displayId: 1 });
  });
});

describe('reachability (the 80 px top-strip rule)', () => {
  it('needs 80 px of the top strip on a work area', () => {
    expect(isReachable({ x: 1920 - 80, y: 100, width: 320, height: 300 }, [D1])).toBe(true);
    expect(isReachable({ x: 1920 - 79, y: 100, width: 320, height: 300 }, [D1])).toBe(false);
    // The strip is above the work area even though the window body overlaps it.
    expect(isReachable({ x: 100, y: -36, width: 320, height: 300 }, [D1])).toBe(false);
    expect(isReachable({ x: 100, y: -35, width: 320, height: 300 }, [D1])).toBe(true);
  });

  it('a window just reachable by its strip is clamped onto that display, not moved to the primary', () => {
    const placed = computeStickyBounds({ ...base, stored: { x: 1920 - 80, y: 100, width: 320, height: 300 }, displays: [D1] });
    expect(placed).toEqual({ x: 1600, y: 100, width: 320, height: 300, displayId: 1 });
  });

  it('displayFor picks the display with the largest overlap', () => {
    expect(displayFor({ x: 1800, y: 0, width: 320, height: 300 }, [D1, D2])).toBe(2);
    expect(displayFor({ x: 1700, y: 0, width: 320, height: 300 }, [D1, D2])).toBe(1);
    expect(displayFor({ x: 9000, y: 0, width: 320, height: 300 }, [D1, D2])).toBeNull();
  });
});
