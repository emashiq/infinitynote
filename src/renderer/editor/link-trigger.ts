import { Extension, InputRule } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { MAX_REF_LABEL } from '../../shared/editor/doc-schema';

/** How the link picker was asked for (D-157). */
export interface LinkRequest {
  /** The selection being linked: its text becomes the link's alias and the first search. */
  selection?: { from: number; to: number; text: string };
  /** "[[" opened the picker; closing it without a link puts the brackets back. */
  typed?: boolean;
}

export interface LinkTriggerOptions {
  /** Opens the picker; false where the window cannot link (stickies), so the keys do nothing (also while read-only). */
  request: (request: LinkRequest) => boolean;
}

export const LINK_TRIGGER = '[[';

/**
 * The selection as link text: plain text inside one textblock, up to the label limit; null otherwise (a selection that
 * holds a chip, spans blocks or is empty links nothing and the picker opens without an alias).
 */
export function linkableSelection(state: EditorState): LinkRequest['selection'] | null {
  const { from, to, $from, $to, empty } = state.selection;
  if (empty || !$from.sameParent($to) || !$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  let atoms = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isInline && !node.isText) atoms = true;
  });
  const text = state.doc.textBetween(from, to);
  if (atoms || text.trim() === '' || text.length > MAX_REF_LABEL) return null;
  return { from, to, text };
}

/**
 * The keys that open the link picker (D-157): typing "[[" (outside code), Ctrl+Shift+L, and Ctrl+Shift+K, which links the
 * selected text. Ctrl+K stays the app's search everywhere.
 */
export const LinkTrigger = Extension.create<LinkTriggerOptions>({
  name: 'linkTrigger',

  addOptions() {
    return { request: () => false };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\[\[$/,
        handler: ({ state, range }) => {
          if (!this.editor.isEditable || !this.options.request({ typed: true })) return null;
          state.tr.delete(range.from, range.to);
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-l': () => this.editor.isEditable && this.options.request({}),
      'Mod-Shift-k': () => {
        if (!this.editor.isEditable) return false;
        const selection = linkableSelection(this.editor.state);
        return this.options.request(selection ? { selection } : {});
      },
    };
  },
});
