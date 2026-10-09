import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { UUID_RE } from '../../shared/contracts/ids';
import type { ReferenceHost } from './editor-services';
import { NoteRefView } from './NoteRefView';

const uuidAttr = (el: HTMLElement, name: string): string | null => {
  const v = el.getAttribute(name);
  return v && UUID_RE.test(v) ? v : null;
};

export interface NoteRefOptions {
  /** Absent in windows that cannot open notes in tabs (stickies): the chip only shows its label. */
  host: ReferenceHost | null;
}

/**
 * An inline link to another note or one of its blocks (INF-REF-01, INF-REF-02, D-098). It stores IDs only; the label
 * and excerpt are what the target looked like when inserted and are shown only when the target is not live.
 */
export const NoteRef = Node.create<NoteRefOptions>({
  name: 'noteRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  marks: '',

  addOptions() {
    return { host: null };
  },

  addAttributes() {
    return {
      noteId: { default: null, parseHTML: (el) => uuidAttr(el, 'data-note-ref'), renderHTML: (a) => ({ 'data-note-ref': a.noteId }) },
      blockId: { default: null, parseHTML: (el) => uuidAttr(el, 'data-block-ref'), renderHTML: (a) => (a.blockId ? { 'data-block-ref': a.blockId } : {}) },
      label: { default: '', parseHTML: (el) => el.textContent ?? '', renderHTML: () => ({}) },
      excerpt: { default: null, parseHTML: (el) => el.getAttribute('data-excerpt'), renderHTML: (a) => (a.excerpt ? { 'data-excerpt': a.excerpt } : {}) },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-note-ref]', getAttrs: (el) => (uuidAttr(el as HTMLElement, 'data-note-ref') ? null : false) }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'note-ref' }), String(node.attrs.label)];
  },

  renderText({ node }) {
    return String(node.attrs.label);
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteRefView, { as: 'span' });
  },
});
