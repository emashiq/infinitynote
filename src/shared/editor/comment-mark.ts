import { Mark } from '@tiptap/core';

/**
 * The anchor of a comment thread in a rich note (F8, D-165): the commented text carries a `comment` mark with the
 * thread's ID. Several threads may cover the same text (the mark does not exclude itself), typing at its edges does
 * not extend it, and it has no look of its own: the main window's note tabs highlight the threads they list.
 *
 * It has no HTML parse rule on purpose: pasted or dropped HTML (a copy from this or another note) never brings a
 * thread ID along, so a copy can never alias a thread. Moving text by dragging keeps the mark (the slice is moved, not
 * parsed), and live sync and stored content carry it as JSON.
 */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      threadId: { default: null, renderHTML: (attrs: Record<string, unknown>) => ({ 'data-comment-thread': attrs.threadId }) },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0];
  },
});
