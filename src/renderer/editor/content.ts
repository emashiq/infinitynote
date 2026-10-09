import type { Transaction } from '@tiptap/pm/state';
import type { RichDocLike } from '../../shared/editor/doc-schema';

/**
 * Marks an app transaction that is not part of undo history but is still an edit (upload completion, block ID
 * repairs). The create-time ID pass carries `addToHistory: false` alone and is not an edit.
 */
export const PERSIST_META = 'infinity:persist';
/** Marks the transaction that applies steps another view made (live sync, D-103). */
export const REMOTE_META = 'infinity:remote';

export function markPersistent(tr: Transaction): Transaction {
  return tr.setMeta('addToHistory', false).setMeta(PERSIST_META, true);
}

/** True for the steps of another view: this view neither edited nor should react as if it had. */
export function isRemote(tr: Transaction): boolean {
  return tr.getMeta(REMOTE_META) === true;
}

/** True when a transaction is an edit made in this view (D-055): opening a note and other views' edits are not. */
export function isUserEdit(tr: Transaction): boolean {
  return tr.docChanged && !isRemote(tr) && (tr.getMeta('addToHistory') !== false || tr.getMeta(PERSIST_META) === true);
}

/** Steps of this view that main has not confirmed yet, at the version they are based on. */
export interface SendableSteps {
  version: number;
  steps: Array<{ stepType: string }>;
}

/** What the note controller reads from the mounted editor (plan section 9.10) and how it syncs it (D-103). */
export interface ContentSource {
  /** The content as it would be saved: a document for rich notes, the text for plain notes. */
  getContent(): RichDocLike | string;
  /** The visible text, one line per block (Compare dialog). */
  getPlainText(): string;
  /** The text of the block with this id (a reminder title), or null when the block is not in the document. */
  blockText(blockId: string): string | null;
  /**
   * The text a reminder source is read in, exactly as main compares it (a hard break is "\n"): a textblock's text, or
   * with no block the whole text of a plain-text note. Null when there is no such text.
   */
  phraseText(blockId: string | null): string | null;
  hasPendingUploads(): boolean;
  /** Resolves true once pending imports finished, or false after `ms`. */
  waitForUploads(ms: number): Promise<boolean>;
  /** The live-sync version of the document (steps confirmed so far). */
  version(): number;
  /** This view's unconfirmed steps, or null when main has confirmed everything. */
  sendable(): SendableSteps | null;
  /**
   * Applies confirmed steps from `version` on (this view's own confirm them); steps it already has are skipped.
   * `gap` when steps before them are missing.
   */
  receive(version: number, steps: ReadonlyArray<{ stepType: string }>, clientIDs: readonly string[]): 'applied' | 'gap';
}

/** The controller side the editor talks to; implemented by NoteController. */
export interface EditorHost {
  /** The note the editor shows (attached files are opened on its behalf). */
  readonly noteId: string;
  attachSource(source: ContentSource): void;
  detachSource(source: ContentSource): void;
  /** The document changed in this view: its steps are sent to main. */
  markDirty(): void;
  flush(): Promise<unknown>;
  contentError(): void;
  /** The block the cursor is in (its id), for reminders on the current paragraph. */
  setCursorBlock(blockId: string | null): void;
}
