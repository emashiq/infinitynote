import { ReactNodeViewRenderer } from '@tiptap/react';
import { NoteRefNode } from '../../shared/editor/nodes';
import type { ReferenceHost } from './editor-services';
import { NoteRefView } from './NoteRefView';

export interface NoteRefOptions {
  /** Absent in windows that cannot open notes in tabs (stickies): the chip only shows its label. */
  host: ReferenceHost | null;
}

/** The note reference chip (D-098): the live title of its target, opening it in a tab where the window can. */
export const NoteRef = NoteRefNode.extend<NoteRefOptions>({
  addOptions() {
    return { host: null };
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteRefView, { as: 'span' });
  },
});
