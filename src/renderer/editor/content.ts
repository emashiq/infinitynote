import type { JSONContent } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import type { RichDocLike } from '../../shared/editor/doc-schema';

/**
 * Marks an app transaction that is not part of undo history but must still be saved (upload completion, block
 * ID repairs). The create-time ID pass and external reloads carry `addToHistory: false` alone and are not edits.
 */
export const PERSIST_META = 'infinity:persist';

export function markPersistent(tr: Transaction): Transaction {
  return tr.setMeta('addToHistory', false).setMeta(PERSIST_META, true);
}

/** True when a transaction is an edit that must be saved (D-055): opening a note never saves. */
export function isUserEdit(tr: Transaction): boolean {
  return tr.docChanged && (tr.getMeta('addToHistory') !== false || tr.getMeta(PERSIST_META) === true);
}

/** What the note controller reads from the mounted editor (plan section 9.10). */
export interface ContentSource {
  /** The content to save: a document for rich notes, the text for plain notes. */
  getContent(): RichDocLike | string;
  /** The visible text, one line per block (Compare dialog). */
  getPlainText(): string;
  /** The text of the block with this id (a reminder title), or null when the block is not in the document. */
  blockText(blockId: string): string | null;
  /**
   * The text a reminder source is read in, exactly as main compares it (a hard break is "
"): a textblock's text, or
   * with no block the whole text of a plain-text note. Null when there is no such text.
   */
  phraseText(blockId: string | null): string | null;
  hasPendingUploads(): boolean;
  /** Resolves true once pending imports finished, or false after `ms`. */
  waitForUploads(ms: number): Promise<boolean>;
}

/** The controller side the editor talks to; implemented by NoteController. */
export interface EditorHost {
  attachSource(source: ContentSource): void;
  detachSource(source: ContentSource): void;
  markDirty(): void;
  flush(): Promise<unknown>;
  contentError(): void;
  /** The block the cursor is in (its id), for reminders on the current paragraph. */
  setCursorBlock(blockId: string | null): void;
}

function savableNodes(nodes: JSONContent[] | undefined): JSONContent[] | undefined {
  if (!nodes) return undefined;
  const out: JSONContent[] = [];
  for (const node of nodes) {
    // A node still uploading has no attachment yet; it is saved once the upload completes.
    if (node.attrs && typeof node.attrs.uploadToken === 'string') continue;
    out.push(node.content ? { ...node, content: savableNodes(node.content) } : node);
  }
  return out;
}

/** The editor document as saved: transient upload nodes removed (main normalizes the rest). */
export function toSavable(json: JSONContent): RichDocLike {
  return { type: 'doc', content: savableNodes(json.content) ?? [] };
}
