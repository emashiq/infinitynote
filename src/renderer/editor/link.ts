import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';

export const LINK_ERROR = 'Use an address that starts with http:// or https://';
export const LINK_OPEN_FAILED = 'This link cannot be opened';

/** The link address at a document position, if the text there is a link. */
export function linkHrefAt(state: EditorState, pos: number): string | null {
  const $pos = state.doc.resolve(pos);
  const marks = [...$pos.marks(), ...(state.doc.nodeAt(pos)?.marks ?? [])];
  const link = marks.find((m) => m.type.name === 'link');
  return link ? (link.attrs.href as string) : null;
}

/** The link address under the selection, or null when the selection is not inside a link. */
export function selectedLinkHref(state: EditorState): string | null {
  const { from, to, empty } = state.selection;
  if (empty) return linkHrefAt(state, from);
  let href: string | null = null;
  let mixed = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const link = node.marks.find((m) => m.type.name === 'link');
    const value = link ? (link.attrs.href as string) : null;
    if (href === null && !mixed) href = value;
    else if (value !== href) mixed = true;
  });
  return mixed ? null : href;
}

/**
 * Sets the link on the selection, on the whole link around the cursor, or (with nothing selected and no link)
 * inserts the address itself as linked text. The address is validated by the caller (parseExternalUrl).
 */
export function applyLink(editor: Editor, href: string): void {
  const { empty } = editor.state.selection;
  if (empty && !editor.isActive('link')) {
    editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
}

export function removeLink(editor: Editor): void {
  editor.chain().focus().extendMarkRange('link').unsetLink().run();
}
