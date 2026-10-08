import { STICKY_DEFAULT, STICKY_HEADER_PX, STICKY_MIN, type StoredBoundsType } from '../../shared/contracts/stickies';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  bounds: Rect;
  workArea: Rect;
}

export type PositioningStatus = 'supported' | 'unsupported' | 'unknown';

/** Where a sticky window opens; x/y are absent where the compositor places windows. */
export interface Placement {
  x?: number;
  y?: number;
  width: number;
  height: number;
  displayId?: number;
}

export interface ComputeStickyBoundsInput {
  stored: StoredBoundsType | null;
  displayHint: number | null;
  displays: readonly DisplayInfo[];
  primaryId: number;
  positioning: PositioningStatus;
  cascadeIndex: number;
}

/** A window is reachable when its top strip overlaps a work area by at least this many pixels horizontally (D-068). */
export const REACHABLE_STRIP_PX = 80;
const EDGE_MARGIN_PX = 32;
const CASCADE_STEP_PX = 24;
const CASCADE_SLOTS = 8;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function intersectionArea(a: Rect, b: Rect): number {
  return overlap(a.x, a.x + a.width, b.x, b.x + b.width) * overlap(a.y, a.y + a.height, b.y, b.y + b.height);
}

/** Horizontal overlap of the window's top strip with a work area (0 when the strip misses it vertically). */
function stripOverlap(r: Rect, wa: Rect): number {
  if (overlap(r.y, r.y + STICKY_HEADER_PX, wa.y, wa.y + wa.height) <= 0) return 0;
  return overlap(r.x, r.x + r.width, wa.x, wa.x + wa.width);
}

/** The reachable displays of a rectangle, best (largest overlap) first. */
function reachableDisplays(r: Rect, displays: readonly DisplayInfo[]): DisplayInfo[] {
  return displays
    .filter((d) => stripOverlap(r, d.workArea) >= REACHABLE_STRIP_PX)
    .sort((a, b) => intersectionArea(r, b.workArea) - intersectionArea(r, a.workArea));
}

export function isReachable(r: Rect, displays: readonly DisplayInfo[]): boolean {
  return reachableDisplays(r, displays).length > 0;
}

/** The display a rectangle mostly lies on, or null when it touches none. */
export function displayFor(r: Rect, displays: readonly DisplayInfo[]): number | null {
  let best: DisplayInfo | null = null;
  let bestArea = 0;
  for (const d of displays) {
    const area = intersectionArea(r, d.bounds);
    if (area > bestArea) {
      best = d;
      bestArea = area;
    }
  }
  return best ? best.id : null;
}

function sizeWithin(stored: StoredBoundsType | null, wa: Rect): { width: number; height: number } {
  return {
    width: Math.round(clamp(stored?.width ?? STICKY_DEFAULT.width, STICKY_MIN.width, wa.width)),
    height: Math.round(clamp(stored?.height ?? STICKY_DEFAULT.height, STICKY_MIN.height, wa.height)),
  };
}

/**
 * Bounds for a sticky window that is about to open or must be recovered after a display change (plan section 8.6,
 * D-068). A reachable window stays on its best display, shifted fully inside it; an unreachable one moves to the
 * hint display (if still connected) or the primary display, centered with a cascade offset.
 */
export function computeStickyBounds(input: ComputeStickyBoundsInput): Placement {
  const { stored, displays } = input;
  const primary = displays.find((d) => d.id === input.primaryId) ?? displays[0];
  if (!primary) return sizeWithin(stored, { x: 0, y: 0, width: STICKY_DEFAULT.width, height: STICKY_DEFAULT.height });
  const k = ((input.cascadeIndex % CASCADE_SLOTS) + CASCADE_SLOTS) % CASCADE_SLOTS;

  if (input.positioning === 'unsupported') return sizeWithin(stored, primary.workArea);
  if (!stored) {
    const wa = primary.workArea;
    const size = sizeWithin(stored, wa);
    return {
      ...size,
      x: Math.round(wa.x + wa.width - size.width - EDGE_MARGIN_PX - CASCADE_STEP_PX * k),
      y: Math.round(wa.y + EDGE_MARGIN_PX + CASCADE_STEP_PX * k),
      displayId: primary.id,
    };
  }

  // A position stored as null was saved where the compositor placed the window; it places it again.
  if (stored.x === null || stored.y === null) return sizeWithin(stored, primary.workArea);
  const rect: Rect = { x: stored.x, y: stored.y, width: Math.max(stored.width, STICKY_MIN.width), height: Math.max(stored.height, STICKY_MIN.height) };
  const best = reachableDisplays(rect, displays)[0];
  const target = best ?? displays.find((d) => d.id === input.displayHint) ?? primary;
  const wa = target.workArea;
  const size = sizeWithin(stored, wa);
  const x = best ? rect.x : wa.x + (wa.width - size.width) / 2 + CASCADE_STEP_PX * k;
  const y = best ? rect.y : wa.y + (wa.height - size.height) / 2 + CASCADE_STEP_PX * k;
  return {
    ...size,
    x: Math.round(clamp(x, wa.x, wa.x + wa.width - size.width)),
    y: Math.round(clamp(y, wa.y, wa.y + wa.height - size.height)),
    displayId: target.id,
  };
}
