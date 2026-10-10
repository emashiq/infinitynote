import { InputRule } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MathBlockNode, MathInlineNode } from '../../../shared/editor/nodes';
import { MathView } from './MathView';

/** Events inside a formula's own input belong to that input, not to the editor. */
const stopEvent = ({ event }: { event: Event }) => event.target instanceof HTMLElement && event.target.closest('.math-edit') !== null;

/** Inline math (D-161): `$x^2$` typed with text around it becomes a formula. */
export const MathInline = MathInlineNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MathView, { as: 'span', stopEvent });
  },

  addInputRules() {
    return [
      new InputRule({
        // "$", TeX that neither starts nor ends with a space and holds no "$", then the closing "$".
        find: /(?:^|[\s(])\$([^\s$](?:[^$]{0,1998}[^\s$])?)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1]!;
          const start = range.to - latex.length - 2;
          state.tr.replaceWith(start, range.to, this.type.create({ latex }));
        },
      }),
    ];
  },
});

/** Block math (D-161): `$$` and a space at the start of an empty line opens a new formula. */
export const MathBlock = MathBlockNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MathView, { stopEvent });
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== 'paragraph' || $from.depth < 1) return null;
          state.tr.replaceWith($from.before(), $from.after(), this.type.create({ latex: '' }));
        },
      }),
    ];
  },
});
