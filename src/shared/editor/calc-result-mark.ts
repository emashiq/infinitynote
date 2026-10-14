import { Mark } from '@tiptap/core';

/**
 * A math result in a rich note (D-188, D-189): the text after a line's "=" that the calculator wrote. Marked results
 * are calculated again when a variable they read changes above them. Typing at its edges does not extend it, and like
 * the comment mark it has no HTML parse rule: pasted text is plain text, never a result.
 */
export const CalcResultMark = Mark.create({
  name: 'calcResult',
  inclusive: false,

  renderHTML() {
    return ['span', { class: 'calc-result', 'data-calc-result': '' }, 0];
  },
});
