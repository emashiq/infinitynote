import type { Editor } from '@tiptap/core';

/**
 * Live editor instances (INF-TABS-07): only the active note tab mounts an editor, so the count is 0 or 1 in the
 * main window. Published on `<html data-live-editors>` for tests and diagnostics.
 */
const live = new Set<Editor>();

function publish(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.liveEditors = String(live.size);
}

export function registerEditor(editor: Editor): () => void {
  live.add(editor);
  publish();
  return () => {
    live.delete(editor);
    publish();
  };
}

export function liveEditorCount(): number {
  return live.size;
}

/** The single live editor, if any (used by tests that drive content through the real editor). */
export function liveEditor(): Editor | null {
  return live.size === 1 ? [...live][0]! : null;
}
