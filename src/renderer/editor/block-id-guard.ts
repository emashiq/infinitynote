import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Mapping, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform';
import { BLOCK_ID_TYPES } from '../../shared/editor/doc-schema';
import { markPersistent } from './content';

const ID_TYPES = new Set<string>(BLOCK_ID_TYPES);

const hasId = (node: PmNode): boolean => ID_TYPES.has(node.type.name) && node.attrs.id != null;

/**
 * The slice with a fresh ID on every block, so pasted content never brings its IDs along and needs no follow-up
 * pass (UniqueID's per-node pass is quadratic on large pastes, QA-2).
 */
function withFreshIds(fragment: Fragment, newId: () => string): Fragment {
  const nodes: PmNode[] = [];
  fragment.forEach((node) => {
    const content = withFreshIds(node.content, newId);
    nodes.push(ID_TYPES.has(node.type.name) ? node.type.create({ ...node.attrs, id: newId() }, content, node.marks) : node.copy(content));
  });
  return Fragment.from(nodes);
}

/** Paste and drop transactions; their slice already carries fresh IDs (see withFreshIds). */
export function isPasteOrDrop(tr: Transaction): boolean {
  const ui = tr.getMeta('uiEvent');
  return ui === 'paste' || ui === 'drop';
}

function fragmentHasId(fragment: Fragment): boolean {
  let found = false;
  fragment.descendants((node) => {
    if (found) return false;
    if (hasId(node)) found = true;
    return !found;
  });
  return found;
}

/** Whether a transaction inserted nodes that carry IDs (the only way an ID can become duplicated). */
function insertsIds(tr: Transaction): boolean {
  return tr.steps.some((step) => (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) && fragmentHasId(step.slice.content));
}

/**
 * Gives every duplicated block ID a fresh value, keeping the occurrence that existed before the transactions
 * (or the first one when none did). Returns null when all IDs are unique.
 */
export function repairDuplicateIds(trs: readonly Transaction[], oldState: EditorState, newState: EditorState, newId: () => string): Transaction | null {
  // One scan of each document: positions of every ID now, then the old positions of the duplicated ones only.
  const positions = new Map<string, number[]>();
  const duplicated = new Set<string>();
  newState.doc.descendants((node, pos) => {
    if (!hasId(node)) return;
    const id = node.attrs.id as string;
    const list = positions.get(id);
    if (list) {
      list.push(pos);
      duplicated.add(id);
    } else positions.set(id, [pos]);
  });
  if (duplicated.size === 0) return null;
  const before = new Map<string, number[]>();
  oldState.doc.descendants((node, pos) => {
    if (hasId(node) && duplicated.has(node.attrs.id as string)) before.set(node.attrs.id as string, [...(before.get(node.attrs.id as string) ?? []), pos]);
  });
  const mapping = new Mapping();
  for (const tr of trs) mapping.appendMapping(tr.mapping);

  let tr: Transaction | null = null;
  for (const id of duplicated) {
    const list = positions.get(id)!;
    const survivors = (before.get(id) ?? []).map((pos) => mapping.map(pos, 1));
    const keep = list.find((pos) => survivors.includes(pos)) ?? list[0]!;
    for (const pos of list) {
      if (pos === keep) continue;
      tr ??= newState.tr;
      const node = tr.doc.nodeAt(pos)!;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newId() }, node.marks);
    }
  }
  return tr ? markPersistent(tr) : null;
}

/**
 * Keeps block IDs unique (D-053, INF-EDIT-06): pasted and dropped content gets fresh IDs (an internal drag move
 * keeps its own), and any transaction that inserts nodes with IDs is followed by a duplicate repair, which covers
 * what UniqueID misses (inserting a copy of an existing block). Both are linear in the document size.
 */
export function createBlockIdGuard(newId: () => string = () => crypto.randomUUID()) {
  return Extension.create({
    name: 'blockIdGuard',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('blockIdGuard'),
          props: {
            transformPasted(slice, view) {
              if (view.dragging?.move) return slice;
              return new Slice(withFreshIds(slice.content, newId), slice.openStart, slice.openEnd);
            },
          },
          appendTransaction(trs, oldState, newState) {
            if (!trs.some((tr) => tr.docChanged && insertsIds(tr))) return null;
            return repairDuplicateIds(trs, oldState, newState, newId);
          },
        }),
      ];
    },
  });
}
