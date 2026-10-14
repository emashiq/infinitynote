/**
 * Window zoom (v0.4.0, D-186): the browser's zoom steps, kept per kind of window. Viewers with a zoom of their own step
 * through their own levels with the same rule.
 */

/** The zoom steps of a window in percent, as browsers offer them. */
export const ZOOM_PERCENTS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300] as const;
export type ZoomPercent = (typeof ZOOM_PERCENTS)[number];
export const DEFAULT_ZOOM: ZoomPercent = 100;

/** Zoom in, zoom out, or back to actual size. */
export const ZOOM_ACTIONS = ['in', 'out', 'reset'] as const;
export type ZoomAction = (typeof ZOOM_ACTIONS)[number];

/** The kinds of window that keep a zoom of their own; every sticky shares one. */
export const ZOOM_KINDS = ['main', 'sticky', 'widget'] as const;
export type ZoomKind = (typeof ZOOM_KINDS)[number];

/**
 * The next level in a direction: the first level above (or below) the current value, which need not be a level itself
 * (a viewer's fitted size); at either end the end level.
 */
export function stepLevel<T extends number>(levels: readonly T[], current: number, direction: 1 | -1): T {
  const sorted = [...levels].sort((a, b) => a - b);
  if (direction > 0) return sorted.find((level) => level > current) ?? sorted[sorted.length - 1]!;
  return [...sorted].reverse().find((level) => level < current) ?? sorted[0]!;
}

/** The window zoom after an action. */
export function nextZoom(current: ZoomPercent, action: ZoomAction): ZoomPercent {
  if (action === 'reset') return DEFAULT_ZOOM;
  return stepLevel(ZOOM_PERCENTS, current, action === 'in' ? 1 : -1);
}
