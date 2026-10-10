/**
 * Which pages the page operations act on (F2, D-131): thumbnails are selected with a click (one page), Ctrl+click
 * (toggle) and Shift+click (a range from the last clicked page), and Space with the keyboard. Indices are 0-based.
 */
export interface PageSelection {
  selected: readonly number[];
  /** The page a Shift range starts from. */
  anchor: number | null;
}

export const NO_SELECTION: PageSelection = { selected: [], anchor: null };

export type SelectMode = 'single' | 'toggle' | 'range';

export function selectPage(selection: PageSelection, index: number, mode: SelectMode): PageSelection {
  if (mode === 'toggle') {
    const has = selection.selected.includes(index);
    return { selected: has ? selection.selected.filter((i) => i !== index) : [...selection.selected, index].sort((a, b) => a - b), anchor: index };
  }
  if (mode === 'range' && selection.anchor !== null) {
    const [from, to] = selection.anchor < index ? [selection.anchor, index] : [index, selection.anchor];
    return { selected: Array.from({ length: to - from + 1 }, (_, k) => from + k), anchor: selection.anchor };
  }
  return { selected: [index], anchor: index };
}

/** The selected pages, or the page in view when none is selected. */
export function pagesToChange(selection: PageSelection, currentIndex: number): number[] {
  return selection.selected.length > 0 ? [...selection.selected] : [currentIndex];
}

/** Where the moved pages are in a new page order (`order[newIndex] = oldIndex`). */
export function selectionAfterMove(order: readonly number[], moved: readonly number[]): PageSelection {
  const selected = moved.map((i) => order.indexOf(i)).sort((a, b) => a - b);
  return { selected, anchor: selected[0] ?? null };
}

/** The pages that are not moving, in order. */
function rest(count: number, moving: readonly number[]): number[] {
  return Array.from({ length: count }, (_, i) => i).filter((i) => !moving.includes(i));
}

/**
 * The position (among the pages not moving) to move `moving` to for one step up (-1) or down (+1): the pages close up
 * where the first of them is, then shift by one. Null when they cannot move further.
 */
export function stepTarget(count: number, moving: readonly number[], step: -1 | 1): number | null {
  const others = rest(count, moving);
  const first = Math.min(...moving);
  const at = others.filter((i) => i < first).length;
  const to = at + step;
  const contiguous = moving.length === Math.max(...moving) - first + 1;
  if (to < 0 || to > others.length) return contiguous ? null : at;
  return to;
}

/** The position (among the pages not moving) for a drop before the page at `slot` (`count` = after the last page). */
export function dropTarget(count: number, moving: readonly number[], slot: number): number {
  return rest(count, moving).filter((i) => i < slot).length;
}
