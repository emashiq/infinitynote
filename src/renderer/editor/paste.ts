import { Slice, type ResolvedPos } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { ATTACHMENT_MESSAGES } from '../../shared/attachments/limits';
import { TABLE_PASTED_AS_TEXT_MESSAGE, TABLE_TOO_LARGE_MESSAGE } from '../../shared/editor/table-limits';
import { textToDoc } from '../../shared/text/textarea-doc';
import { sanitizePastedHtml } from './sanitize';
import { tableClipboardText, tableSliceFromText } from './table-clipboard';
import { fragmentTablesFit } from './table-size';
import type { AttachmentUploader } from './uploader';

export interface PasteDeps {
  format: 'rich' | 'plain';
  uploader: AttachmentUploader;
  notify: (message: string) => void;
  /** Saves pending edits; awaited before a large paste so earlier typing is acknowledged first (QA-2). */
  flushPending: () => Promise<unknown>;
}

/** Largest clipboard text or HTML the editor accepts, in characters (D-060). */
export const MAX_PASTE_CHARS = 8 * 1024 * 1024;
/** From this size on, pending edits are saved before the paste is processed (D-060). */
export const LARGE_PASTE_CHARS = 256 * 1024;
export const PASTE_TOO_LARGE = 'This paste is too large (over 8 MB). Paste a smaller part.';

/** Plain text as paragraphs, merged into the paragraphs around the cursor like a normal text paste. */
function insertPlainText(view: EditorView, text: string, at?: number): void {
  const doc = view.state.schema.nodeFromJSON(textToDoc(text));
  const slice = new Slice(doc.content, 1, 1);
  const tr = at === undefined ? view.state.tr.replaceSelection(slice) : view.state.tr.replace(at, at, slice);
  view.dispatch(tr.scrollIntoView());
}

/**
 * Paste and drop handling (plan section 9.4). Everything is decided on the DOM event, before ProseMirror parses
 * the clipboard: files are captured synchronously (the DataTransfer is empty after the first await, D-054), pastes
 * over 8 MB are refused, and large pastes first save pending edits, then run (D-060). Plain-text notes take text
 * only. Rich notes sanitize pasted HTML before parsing, refuse a pasted table over the table limits (D-116) and read
 * tab-separated text as a table; copying table content adds tab-separated text.
 */
export function createPasteProps(deps: PasteDeps) {
  const { format, uploader, notify } = deps;
  /** True while a deferred large paste is handed back to ProseMirror. */
  let replaying = false;

  /** Runs a paste now, or after saving pending edits when it is large. */
  const runPaste = (view: EditorView, size: number, paste: () => void): void => {
    if (size <= LARGE_PASTE_CHARS) {
      paste();
      return;
    }
    void deps.flushPending().finally(() => {
      if ((view as EditorView & { isDestroyed?: boolean }).isDestroyed) return;
      replaying = true;
      try {
        paste();
      } finally {
        replaying = false;
      }
    });
  };

  const acceptFiles = (files: File[], insert: () => void): void => {
    if (format === 'plain') {
      notify(files.some((f) => f.type.startsWith('image/')) ? ATTACHMENT_MESSAGES.plainNoImages : ATTACHMENT_MESSAGES.plainNoFiles);
      return;
    }
    insert();
  };

  const pasteFromEvent = (view: EditorView, event: ClipboardEvent): boolean => {
    if (replaying || !event.clipboardData) return false;
    const files = Array.from(event.clipboardData.files ?? []);
    if (files.length > 0) {
      event.preventDefault();
      const { from, to } = view.state.selection;
      acceptFiles(files, () => uploader.insertFiles(files, { from, to }));
      return true;
    }
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    const size = Math.max(html.length, text.length);
    if (size > MAX_PASTE_CHARS) {
      event.preventDefault();
      notify(PASTE_TOO_LARGE);
      return true;
    }
    if (format === 'plain') {
      event.preventDefault();
      runPaste(view, size, () => insertPlainText(view, text));
      return true;
    }
    if (size <= LARGE_PASTE_CHARS) return false;
    event.preventDefault();
    runPaste(view, size, () => (html ? view.pasteHTML(html, event) : view.pasteText(text, event)));
    return true;
  };

  return {
    handleDOMEvents: {
      paste: pasteFromEvent,
      drop(_view: EditorView, event: DragEvent): boolean {
        const data = event.dataTransfer;
        if (!data || data.files.length > 0) return false;
        if (Math.max(data.getData('text/html').length, data.getData('text/plain').length) <= MAX_PASTE_CHARS) return false;
        event.preventDefault();
        notify(PASTE_TOO_LARGE);
        return true;
      },
    },

    handleDrop(view: EditorView, event: DragEvent, _slice: Slice, moved: boolean): boolean {
      if (moved) return false;
      const files = Array.from(event.dataTransfer?.files ?? []);
      const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
      if (files.length > 0) {
        event.preventDefault();
        acceptFiles(files, () => uploader.insertFiles(files, { from: at, to: at }));
        return true;
      }
      if (format === 'plain') {
        event.preventDefault();
        insertPlainText(view, event.dataTransfer?.getData('text/plain') ?? '', at);
        return true;
      }
      return false;
    },

    /** Runs before the table plugin lays pasted cells out, so a table over the limits is never expanded (D-116). */
    handlePaste(_view: EditorView, _event: ClipboardEvent, slice: Slice): boolean {
      if (format !== 'rich' || fragmentTablesFit(slice.content)) return false;
      notify(TABLE_TOO_LARGE_MESSAGE);
      return true;
    },

    transformPastedHTML(html: string): string {
      return sanitizePastedHtml(html, { onDataImage: (token, mime, base64) => uploader.queueDataImage(token, mime, base64) });
    },

    /**
     * Tab-separated text with several rows and columns (a spreadsheet copy without HTML) becomes a table in rich notes;
     * ProseMirror never asks inside code blocks. "Paste as plain text" keeps it text, except for a deferred large paste,
     * which ProseMirror always marks as plain.
     */
    clipboardTextParser(text: string, _context: ResolvedPos, plain: boolean, view: EditorView): Slice {
      const table = format === 'rich' && (!plain || replaying) ? tableSliceFromText(text, view.state.schema, () => notify(TABLE_PASTED_AS_TEXT_MESSAGE)) : null;
      // Without a slice ProseMirror parses the text itself (its typing leaves out that a parser may return nothing).
      return table as Slice;
    },

    /** A copy holding table content also puts tab-separated text on the clipboard (spreadsheets paste it as cells). */
    clipboardTextSerializer(slice: Slice, view: EditorView): string {
      return (format === 'rich' && tableClipboardText(slice, view.state.schema)) || '';
    },
  };
}
