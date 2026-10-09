import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Selection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BLOCK_ID_TYPES } from '../../shared/editor/doc-schema';

/** One chip: a reminder anchored to a block (D-080). */
export interface ChipInfo {
  reminderId: string;
  blockId: string;
  /** Short due time in the reminder's zone ("Fri 9 Oct, 17:00"). */
  label: string;
  state: 'pending' | 'overdue' | 'snoozed' | 'done';
  /** "Reminder: <title>, <primary due line>". */
  ariaLabel: string;
}

interface ChipsState {
  chips: readonly ChipInfo[];
  /** The block briefly highlighted after a reminder opened it. */
  reveal: string | null;
  decorations: DecorationSet;
}

type ChipsMeta = { chips?: readonly ChipInfo[]; reveal?: string | null };

export const reminderChipsKey = new PluginKey<ChipsState>('reminderChips');
/** Dispatched (bubbling) by a chip on click; `detail` is the reminder id. The editor's owner decides what it does. */
export const REMINDER_CHIP_EVENT = 'reminder-chip';

const ID_TYPES = new Set<string>(BLOCK_ID_TYPES);
const CONTAINERS = new Set(['blockquote', 'listItem', 'taskItem']);
const SVG_NS = 'http://www.w3.org/2000/svg';

/** lucide's Bell icon, drawn without React (decorations are plain DOM). */
function bellIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ width: '12', height: '12', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'aria-hidden': 'true' })) {
    svg.setAttribute(k, v);
  }
  for (const d of ['M10.268 21a2 2 0 0 0 3.464 0', 'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function chipDom(chip: ChipInfo): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('contenteditable', 'false');
  button.className = `reminder-chip reminder-chip-${chip.state}`;
  button.dataset.reminderId = chip.reminderId;
  button.setAttribute('aria-label', chip.ariaLabel);
  button.title = chip.ariaLabel;
  button.append(bellIcon(), document.createTextNode(chip.label));
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', (e) => {
    e.preventDefault();
    button.dispatchEvent(new CustomEvent(REMINDER_CHIP_EVENT, { bubbles: true, detail: chip.reminderId }));
  });
  return button;
}

/** Where a block's chips go: after a textblock's text, after a container's first textblock, right after an atom. */
function chipPosition(node: PmNode, pos: number): number {
  if (node.isTextblock) return pos + node.nodeSize - 1;
  if (CONTAINERS.has(node.type.name)) {
    let at = -1;
    node.forEach((child, offset) => {
      if (at < 0 && child.isTextblock) at = pos + 1 + offset + child.nodeSize - 1;
    });
    return at;
  }
  return node.isAtom ? pos + node.nodeSize : -1;
}

/** The block with this id and its position, or null. */
export function findBlock(doc: PmNode, blockId: string): { node: PmNode; pos: number } | null {
  let found: { node: PmNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (ID_TYPES.has(node.type.name) && node.attrs.id === blockId) found = { node, pos };
    return !found;
  });
  return found;
}

/** The innermost block with an id around the selection (the paragraph inside a list item, a selected image). */
export function blockIdAtSelection(selection: Selection): string | null {
  if (selection instanceof NodeSelection && ID_TYPES.has(selection.node.type.name)) return (selection.node.attrs.id as string | null) ?? null;
  const $from = selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (ID_TYPES.has(node.type.name) && typeof node.attrs.id === 'string') return node.attrs.id;
  }
  return null;
}

/** A cursor at the start of a block (an atom is selected whole). */
export function selectionAtBlockStart(doc: PmNode, target: { node: PmNode; pos: number }): Selection {
  return target.node.isAtom ? NodeSelection.create(doc, target.pos) : TextSelection.near(doc.resolve(target.pos + 1));
}

/** Chips for the blocks that have reminders (chips for unknown blocks are dropped) and the reveal highlight. */
function buildDecorations(doc: PmNode, chips: readonly ChipInfo[], reveal: string | null): DecorationSet {
  if (chips.length === 0 && reveal === null) return DecorationSet.empty;
  const byBlock = new Map<string, ChipInfo[]>();
  for (const chip of chips) byBlock.set(chip.blockId, [...(byBlock.get(chip.blockId) ?? []), chip]);
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    const id = ID_TYPES.has(node.type.name) ? (node.attrs.id as string | null) : null;
    if (!id) return true;
    if (id === reveal) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'reveal-block' }));
    const list = byBlock.get(id);
    const at = list ? chipPosition(node, pos) : -1;
    if (list && at >= 0) {
      list.forEach((chip, i) =>
        decorations.push(
          Decoration.widget(at, () => chipDom(chip), {
            side: node.isAtom ? -1 : 1 + i,
            key: `${chip.reminderId}:${chip.label}:${chip.state}:${chip.ariaLabel}`,
            ignoreSelection: true,
            stopEvent: () => true,
          }),
        ),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

/** A transaction that only replaces chips or the highlight: no document change and not in undo history (D-080). */
export function chipsMeta(state: EditorState, meta: ChipsMeta): Transaction {
  return state.tr.setMeta(reminderChipsKey, meta).setMeta('addToHistory', false);
}

/**
 * Reminder chips (D-080, INF-REM-04): widget decorations after the anchored block's text, and the short highlight of a
 * block a reminder opened. They are not document content, so they are never saved, never undone and never copied.
 */
export const ReminderChips = createReminderChips();

function createReminderChips() {
  return Extension.create({
    name: 'reminderChips',
    addProseMirrorPlugins() {
      return [
        new Plugin<ChipsState>({
          key: reminderChipsKey,
          state: {
            init: () => ({ chips: [], reveal: null, decorations: DecorationSet.empty }),
            apply(tr, value, _old, newState) {
              const meta = tr.getMeta(reminderChipsKey) as ChipsMeta | undefined;
              if (meta) {
                const chips = meta.chips ?? value.chips;
                const reveal = meta.reveal === undefined ? value.reveal : meta.reveal;
                return { chips, reveal, decorations: buildDecorations(newState.doc, chips, reveal) };
              }
              return tr.docChanged ? { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) } : value;
            },
          },
          props: {
            decorations: (state) => reminderChipsKey.getState(state)?.decorations,
          },
        }),
      ];
    },
  });
}
