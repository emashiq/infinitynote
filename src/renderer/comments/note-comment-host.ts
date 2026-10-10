import type { Editor } from '@tiptap/core';
import { COMMENT_MESSAGES, type CommentThreadDtoType } from '../../shared/contracts/comments';
import { addCommentMark, commentableSelection, commentLookMeta, commentMarksKey, markedThreads, removeCommentMark, revealCommentMark } from '../editor/comments/comment-marks';
import type { EditorHandle } from '../editor/editor-handle';
import type { CommentAnchorHost } from './comments-store';

export const NOTE_READ_ONLY = 'This note cannot be changed right now';

/**
 * Comments in a note tab (D-165): a thread is anchored by a `comment` mark on its text. The note's editor comes from
 * the tab's editor handle, so a fresh editor (reload, conversion) gets the highlights again.
 */
export function createNoteCommentHost(noteId: string, handle: EditorHandle): CommentAnchorHost {
  let shown: { threads: readonly CommentThreadDtoType[]; activeId: string | null } = { threads: [], activeId: null };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  const live = (): Editor | null => {
    const editor = handle.current();
    return editor && !editor.isDestroyed ? editor : null;
  };
  const applyLook = () => {
    const editor = live();
    if (!editor) return;
    const open = new Set(shown.threads.filter((t) => t.resolvedAt === null).map((t) => t.id));
    editor.view.dispatch(commentLookMeta(editor.state, { open, active: shown.activeId }));
  };
  const clearPending = () => {
    const editor = live();
    if (editor && commentMarksKey.getState(editor.state)?.pending) editor.view.dispatch(commentLookMeta(editor.state, { pending: null }));
  };

  // The handle's editor changes when the note is reopened; edits change which threads still have their text.
  let followed: Editor | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onUpdate = () => {
    if (timer === null)
      timer = setTimeout(() => {
        timer = null;
        notify();
      }, 200);
  };
  const follow = () => {
    followed?.off('update', onUpdate);
    followed = live();
    followed?.on('update', onUpdate);
    applyLook();
    notify();
  };
  const startFollowing = () => {
    follow();
    const off = handle.subscribe(follow);
    return () => {
      off();
      followed?.off('update', onUpdate);
      followed = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
  };
  let stopFollowing: (() => void) | null = null;

  return {
    target: { kind: 'note', id: noteId },
    begin() {
      const editor = live();
      if (!editor?.isEditable) return { error: NOTE_READ_ONLY };
      if (!editor.schema.marks.comment) return { error: COMMENT_MESSAGES.plainNote };
      const selected = commentableSelection(editor.state);
      if ('error' in selected) return selected;
      editor.view.dispatch(commentLookMeta(editor.state, { pending: { from: selected.from, to: selected.to } }));
      return { anchor: { type: 'text', blockId: selected.blockId }, quote: selected.quote };
    },
    attach(threadId) {
      const editor = live();
      const pending = editor ? commentMarksKey.getState(editor.state)?.pending : null;
      if (!editor || !pending) return;
      editor.view.dispatch(commentLookMeta(editor.state, { pending: null }));
      addCommentMark(editor, pending, threadId);
    },
    cancel: clearPending,
    reveal: (thread) => {
      const editor = live();
      return editor ? revealCommentMark(editor, thread.id) : false;
    },
    detach(threadId) {
      const editor = live();
      if (editor?.isEditable) removeCommentMark(editor, threadId);
    },
    show(threads, activeId) {
      shown = { threads, activeId };
      applyLook();
    },
    orphans(threads) {
      const editor = live();
      if (!editor) return null;
      const marked = markedThreads(editor.state.doc);
      return new Set(threads.filter((t) => !marked.has(t.id)).map((t) => t.id));
    },
    subscribe(listener) {
      listeners.add(listener);
      stopFollowing ??= startFollowing();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stopFollowing?.();
        stopFollowing = null;
      };
    },
  };
}
