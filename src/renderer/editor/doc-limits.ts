import { Extension, getChangedRanges } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { MAX_DOC_DEPTH, MAX_DOC_NODES } from '../../shared/editor/doc-schema';

export const TOO_DEEP_MESSAGE = 'This would nest lists or quotes more deeply than a note can store. Use fewer levels.';
export const TOO_MANY_PARTS_MESSAGE = 'This would make the note too large to store. Paste or add a smaller part.';

/**
 * Nodes overlapping the range of a document (nodesBetween stops at its end); the same rule for the old and new
 * document gives the change.
 */
function countInRange(doc: PmNode, from: number, to: number): number {
  let nodes = 0;
  doc.nodesBetween(from, to, () => {
    nodes += 1;
  });
  return nodes;
}

function subtreeDepth(node: PmNode, level: number): number {
  let depth = level;
  node.forEach((child) => {
    depth = Math.max(depth, subtreeDepth(child, level + 1));
  });
  return depth;
}

/**
 * The deepest level (doc children are level 1, as normalizeRichDoc counts) among nodes touching [from, to]: nodes
 * that contain the whole range are only passed through, every other touching node is measured with its subtree,
 * which covers content moved deeper by a wrap (an indented list item).
 */
function depthAround(doc: PmNode, from: number, to: number): number {
  let depth = 0;
  const walk = (node: PmNode, start: number, level: number) => {
    node.forEach((child, offset) => {
      const pos = start + offset;
      const end = pos + child.nodeSize;
      if (end < from || pos > to) return;
      if (pos < from && end > to) {
        depth = Math.max(depth, level);
        walk(child, pos + 1, level + 1);
      } else {
        depth = Math.max(depth, subtreeDepth(child, level));
      }
    });
  };
  walk(doc, 0, 1);
  return depth;
}

function countNodes(doc: PmNode): number {
  let n = 0;
  doc.descendants(() => {
    n += 1;
  });
  return n;
}

interface Delta {
  added: number;
  depth: number;
}

/**
 * Keeps every document within what `normalizeRichDoc` accepts (QA-3): a change that would nest deeper than 64
 * levels or grow the note past 100,000 parts is refused with a message, so a note never reaches a state it cannot
 * save. The work is proportional to the size of each change; the node count is tracked incrementally, and the change
 * of a transaction is measured once for both the filter and the state update (F-03-2).
 */
export function createDocLimits(notify: (message: string) => void, limits = { depth: MAX_DOC_DEPTH, nodes: MAX_DOC_NODES }) {
  const key = new PluginKey<number>('docLimits');
  return Extension.create({
    name: 'docLimits',
    addProseMirrorPlugins() {
      const measured = new WeakMap<Transaction, Delta>();
      const delta = (tr: Transaction): Delta => {
        const cached = measured.get(tr);
        if (cached) return cached;
        let added = 0;
        let depth = 0;
        for (const { oldRange, newRange } of getChangedRanges(tr)) {
          added += countInRange(tr.doc, newRange.from, newRange.to) - countInRange(tr.before, oldRange.from, oldRange.to);
          depth = Math.max(depth, depthAround(tr.doc, newRange.from, newRange.to));
        }
        const result = { added, depth };
        measured.set(tr, result);
        return result;
      };
      return [
        new Plugin<number>({
          key,
          state: {
            init: (_config, state) => countNodes(state.doc),
            apply: (tr, count) => (tr.docChanged ? count + delta(tr).added : count),
          },
          filterTransaction(tr, state) {
            if (!tr.docChanged) return true;
            const change = delta(tr);
            if (change.depth > limits.depth) {
              notify(TOO_DEEP_MESSAGE);
              return false;
            }
            if (change.added > 0 && (key.getState(state) ?? 0) + change.added > limits.nodes) {
              notify(TOO_MANY_PARTS_MESSAGE);
              return false;
            }
            return true;
          },
        }),
      ];
    },
  });
}
