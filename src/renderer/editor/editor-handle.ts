import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';

export type EditorFocusTarget = 'start' | 'end';

/**
 * The editor of one note view as seen from outside it (the tab or sticky title field, a sticky's float request). Focus moves
 * synchronously, so keys typed right after Enter in the title already reach the text, and a request made before the
 * editor is attached or editable is kept and applied once it is (A08-F1).
 */
export class EditorHandle {
  private editor: Editor | null = null;
  private pending: { target: EditorFocusTarget; origin: Element | null } | null = null;

  attach(editor: Editor): void {
    this.editor = editor;
    this.applyPending();
  }

  detach(editor: Editor): void {
    if (this.editor === editor) this.editor = null;
  }

  /** The attached editor became editable: a waiting focus request can now be applied. */
  editableChanged(): void {
    this.applyPending();
  }

  /**
   * Moves the focus into the text now, or as soon as an editable editor is attached. With an origin, a request that
   * has to wait is dropped if the focus has meanwhile moved somewhere else than the origin.
   */
  focus(target: EditorFocusTarget, origin: Element | null = null): void {
    this.pending = { target, origin };
    this.applyPending();
  }

  private applyPending(): void {
    const editor = this.editor;
    const request = this.pending;
    if (!request || !editor || editor.isDestroyed || !editor.isEditable) return;
    this.pending = null;
    const active = document.activeElement;
    if (request.origin && active !== request.origin && active !== document.body && active !== null) return;
    const { doc } = editor.state;
    const selection = request.target === 'start' ? Selection.atStart(doc) : Selection.atEnd(doc);
    editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
    editor.view.focus();
  }
}
