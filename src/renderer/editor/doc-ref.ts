import { ReactNodeViewRenderer } from '@tiptap/react';
import { DocRefNode } from '../../shared/editor/nodes';
import { DocRefView } from './DocRefView';
import type { NoteRefOptions } from './note-ref';

/** The document link chip (D-156): the live title and kind of its document, opening it at its place where the window can. */
export const DocRef = DocRefNode.extend<NoteRefOptions>({
  addOptions() {
    return { host: null };
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocRefView, { as: 'span' });
  },
});
