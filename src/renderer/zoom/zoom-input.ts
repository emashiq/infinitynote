import type { ZoomAction } from '../../shared/zoom';
import type { KeyLike } from '../state/shortcuts';

/**
 * The browser's zoom keys (D-186): Ctrl+= or Ctrl++ (also Numpad +) zooms in, Ctrl+- (also Numpad -) zooms out, Ctrl+0
 * is actual size. Shift is allowed for "+" (Shift+= on many layouts, Shift+0 on German ones); Alt is not, so AltGr
 * characters never zoom.
 */
export function zoomActionOf(e: KeyLike): ZoomAction | null {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') return 'in';
  if (e.key === '-' || e.code === 'NumpadSubtract') return 'out';
  if (!e.shiftKey && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) return 'reset';
  return null;
}

/** Wheel distance (in pixels) a touchpad gesture travels per zoom step after the first. */
const WHEEL_STEP_DISTANCE = 100;
/** A pause this long (ms) ends a wheel gesture. */
const WHEEL_GESTURE_GAP_MS = 250;
const LINE_PX = 40;

/**
 * Turns Ctrl+wheel events into zoom steps for a viewer: the first event of a gesture is one step (a mouse wheel notch),
 * and a touchpad's stream of small deltas adds a step per WHEEL_STEP_DISTANCE, so a gesture does not race to the end.
 */
export function createWheelStepper(): (e: { deltaY: number; deltaMode: number; timeStamp: number }) => 1 | -1 | 0 {
  let travelled = 0;
  let last = -Infinity;
  return (e) => {
    const delta = e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaY;
    const fresh = e.timeStamp - last > WHEEL_GESTURE_GAP_MS;
    last = e.timeStamp;
    travelled = fresh ? 0 : travelled + delta;
    if (delta === 0 || (!fresh && Math.abs(travelled) < WHEEL_STEP_DISTANCE)) return 0;
    travelled = 0;
    return delta < 0 ? 1 : -1;
  };
}
