import { Extension, getChangedRanges } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Characters without whitespace above which a block wraps with `word-break: break-all` (F-03-1). Chromium's emergency
 * wrapping of one unbroken complex-script word (Bangla) grows superlinearly (about 1.7 s for 256K characters); with
 * break-all the same text lays out in about 0.1 s. Runs this long can never fit on one line, so the visible wrapping
 * of the run itself is the same; the text is not changed.
 */
export const LONG_RUN_CHARS = 4096;
export const LONG_RUN_CLASS = 'long-run';

/** Whether the text has a run of more than `limit` characters without whitespace. */
export function hasLongRun(text: string, limit = LONG_RUN_CHARS): boolean {
  if (text.length <= limit) return false;
  let run = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    // Whitespace that offers a line break: space, tab, line breaks and the Unicode spaces.
    const space = code === 32 || code === 9 || code === 10 || code === 13 || (code >= 0x2000 && code <= 0x200a) || code === 0x3000;
    run = space ? 0 : run + 1;
    if (run > limit) return true;
  }
  return false;
}

/**
 * Decorations for the text blocks touching [from, to], boundaries included, which is the rule DecorationSet.find uses
 * for the decorations a change replaces.
 */
function decorate(doc: PmNode, from: number, to: number): Decoration[] {
  const found: Decoration[] = [];
  doc.nodesBetween(Math.max(0, from - 1), Math.min(doc.content.size, to + 1), (node, pos) => {
    if (!node.isTextblock) return true;
    if (hasLongRun(node.textContent)) found.push(Decoration.node(pos, pos + node.nodeSize, { class: LONG_RUN_CLASS }));
    return false;
  });
  return found;
}

const key = new PluginKey<DecorationSet>('longRuns');

/** Marks blocks with a very long unbroken run, re-checking only the blocks a transaction changed. */
export const LongRuns = Extension.create({
  name: 'longRuns',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => DecorationSet.create(state.doc, decorate(state.doc, 0, state.doc.content.size)),
          apply(tr, set) {
            if (!tr.docChanged) return set;
            let next = set.map(tr.mapping, tr.doc);
            for (const { newRange } of getChangedRanges(tr)) {
              next = next.remove(next.find(newRange.from, newRange.to)).add(tr.doc, decorate(tr.doc, newRange.from, newRange.to));
            }
            return next;
          },
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});
