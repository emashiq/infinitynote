import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'react';
import type { EditorHandle } from './editor-handle';

/** How long after an edit derived views (outline, counts) are read again. */
export const EDITOR_DOC_DEBOUNCE_MS = 200;

/**
 * A value read from the editor a handle has attached, read again a moment after each change of its document and when
 * another editor is attached (D-162); null while no editor is attached.
 */
export function useEditorDoc<T>(handle: EditorHandle, read: (editor: Editor) => T): { value: T | null; editor: Editor | null } {
  const [state, setState] = useState<{ value: T | null; editor: Editor | null }>({ value: null, editor: null });
  useEffect(() => {
    let editor: Editor | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      timer = null;
      setState(editor && !editor.isDestroyed ? { value: read(editor), editor } : { value: null, editor: null });
    };
    const schedule = () => {
      if (timer === null) timer = setTimeout(update, EDITOR_DOC_DEBOUNCE_MS);
    };
    const follow = () => {
      editor?.off('update', schedule);
      editor = handle.current();
      editor?.on('update', schedule);
      update();
    };
    follow();
    const off = handle.subscribe(follow);
    return () => {
      off();
      editor?.off('update', schedule);
      if (timer !== null) clearTimeout(timer);
    };
    // `read` is a pure reader chosen by the caller once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);
  return state;
}
