import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

/** Most headings the outline lists. */
export const MAX_OUTLINE = 500;

export interface OutlineItem {
  level: number;
  text: string;
  /** The heading's position in the document. */
  pos: number;
}

/** The headings of a document in order (D-162), including those inside lists, quotes and tables. */
export function outlineOf(doc: PmNode): OutlineItem[] {
  const items: OutlineItem[] = [];
  doc.descendants((node, pos) => {
    if (items.length >= MAX_OUTLINE) return false;
    if (node.type.name !== 'heading') return true;
    items.push({ level: Number(node.attrs.level) || 1, text: node.textContent.trim(), pos });
    return false;
  });
  return items;
}

/** Puts the cursor at the start of the heading at `pos`, scrolls it into view and focuses the text. */
export function revealHeading(editor: Editor, pos: number): void {
  if (editor.isDestroyed || pos >= editor.state.doc.content.size) return;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos + 1))).scrollIntoView());
  editor.view.focus();
}
