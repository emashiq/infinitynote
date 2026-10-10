import type { ShapeBox } from './pptx-xml';

/** The eight resize handles of a selected drawing, by compass direction. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Handle = (typeof HANDLES)[number];

/** The smallest a drawing gets by resizing, in EMU (about 2 px). */
const MIN_SIDE = 19_050;

/** A box moved by a distance in EMU. */
export const moved = (box: ShapeBox, dx: number, dy: number): ShapeBox => ({ ...box, offsetX: box.offsetX + dx, offsetY: box.offsetY + dy });

/** A box resized by dragging a handle a distance in EMU; the opposite side or corner stays where it was. */
export function resized(box: ShapeBox, handle: Handle, dx: number, dy: number): ShapeBox {
  let { offsetX: left, offsetY: top } = box;
  let right = left + box.width;
  let bottom = top + box.height;
  if (handle.includes('w')) left = Math.min(left + dx, right - MIN_SIDE);
  if (handle.includes('e')) right = Math.max(right + dx, left + MIN_SIDE);
  if (handle.includes('n')) top = Math.min(top + dy, bottom - MIN_SIDE);
  if (handle.includes('s')) bottom = Math.max(bottom + dy, top + MIN_SIDE);
  return { offsetX: left, offsetY: top, width: right - left, height: bottom - top };
}

/**
 * Snaps a moved box to the slide (D-151): when its left, center or right edge comes within `tolerance` EMU of the
 * slide's left edge, center or right edge, it lines up exactly; likewise vertically.
 */
export function snapped(box: ShapeBox, slide: { width: number; height: number }, tolerance: number): ShapeBox {
  const axis = (start: number, size: number, extent: number) => {
    const guides = [0, extent / 2, extent];
    let best: number | null = null;
    for (const edge of [start, start + size / 2, start + size]) {
      for (const guide of guides) {
        const delta = guide - edge;
        if (Math.abs(delta) <= tolerance && (best === null || Math.abs(delta) < Math.abs(best))) best = delta;
      }
    }
    return start + (best ?? 0);
  };
  return { ...box, offsetX: axis(box.offsetX, box.width, slide.width), offsetY: axis(box.offsetY, box.height, slide.height) };
}

/** What an arrow key does to a selected drawing: move it, or with Shift grow or shrink it from its far side. */
export function nudged(box: ShapeBox, key: string, step: number, resize: boolean): ShapeBox | null {
  const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const d = delta[key];
  if (!d) return null;
  return resize ? resized(box, 'se', d[0], d[1]) : moved(box, d[0], d[1]);
}
