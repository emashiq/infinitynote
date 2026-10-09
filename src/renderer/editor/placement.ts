import { posToDOMRect } from '@tiptap/core';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { selectedLinkHref } from './link';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * What the floating formatting toolbar shows (D-102): text formatting for a selection (or on request, Alt+F10), the
 * size presets for a selected image, the link actions while the cursor is in a link, or nothing.
 */
export type BubbleKind = 'format' | 'image' | 'link' | null;

export function bubbleKind(state: EditorState, opts: { editable: boolean; requested: boolean }): BubbleKind {
  const { selection } = state;
  if (selection instanceof NodeSelection) return opts.editable && selection.node.type.name === 'image' ? 'image' : null;
  if (opts.editable && (opts.requested || !selection.empty)) return 'format';
  return selectedLinkHref(state) !== null ? 'link' : null;
}

/** The screen box of the selection: a selected node's own box, else the selected text (or the cursor). */
export function selectionBox(view: EditorView): Box {
  const { selection } = view.state;
  if (selection instanceof NodeSelection) {
    const dom = view.nodeDOM(selection.from);
    if (dom instanceof HTMLElement) return dom.getBoundingClientRect();
  }
  return posToDOMRect(view, selection.from, selection.to);
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Where a floating box of `size` goes next to `target`, as offsets inside `surface` (all boxes in viewport
 * coordinates). It takes the preferred side unless only the other side of the visible `viewport` has room, and it
 * never sticks out of the surface sideways.
 */
export function placeFloating(opts: {
  target: Box;
  size: { width: number; height: number };
  surface: Box;
  viewport: Box;
  side: 'above' | 'below';
  align: 'center' | 'start';
  gap?: number;
}): { left: number; top: number } {
  const { target, size, surface, viewport, side, align, gap = 8 } = opts;
  const needed = size.height + gap;
  const roomAbove = target.top - viewport.top;
  const roomBelow = viewport.bottom - target.bottom;
  const preferred = side === 'above' ? roomAbove : roomBelow;
  const other = side === 'above' ? roomBelow : roomAbove;
  const flip = preferred < needed && other >= needed;
  const above = side === 'above' ? !flip : flip;
  const top = above ? target.top - gap - size.height : target.bottom + gap;
  const x = align === 'center' ? (target.left + target.right) / 2 - size.width / 2 : target.left;
  const maxLeft = Math.max(0, surface.right - surface.left - size.width);
  return { left: Math.round(clamp(x - surface.left, 0, maxLeft)), top: Math.round(top - surface.top) };
}
