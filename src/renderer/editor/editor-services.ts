import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { DocumentKind } from '../../shared/documents/kinds';
import type { DocumentTargetType } from '../../shared/documents/targets';
import type { SuggestionContext } from '../reminders/suggestion-context';
import type { AddAction } from '../../shared/attachments/file-choice';
import type { AttachmentPrefs } from './uploader';

/**
 * What the editor needs from the app; passed in so the same editor serves tabs and (Phase 04) stickies. Must be a
 * stable object (each editor instance creates its uploader from it once).
 */
export interface EditorServices {
  bridge: Pick<InfinityBridge, 'attachment' | 'fileLink' | 'shell' | 'palette' | 'notes' | 'links'>;
  notify: (message: string) => void;
  attachmentPrefs: () => AttachmentPrefs;
  /** Saves "When adding files" from the "Add files" dialog; absent where settings cannot be written (stickies). */
  rememberAddFiles?: (action: AddAction) => void;
  /** Reminder suggestions: main's reference context, dismissals and the suggestion settings (D-091). */
  suggestions: SuggestionContext;
  /** Note references (main window only): live titles for the chips and opening a reference in a tab. */
  references?: ReferenceHost;
  /** "Open in Infinity Notes" for attached and linked files of a supported kind (main window only, D-118). */
  documents?: DocumentHost;
  /** Comments on the selected text (main window only, D-165). */
  comments?: CommentStarter;
}

/** Starts a comment on the active note's selection: the Comments section opens with a new comment. */
export interface CommentStarter {
  start(): void;
}

/** Opens a note's attached or linked file as a document in a tab (D-118). */
export interface DocumentHost {
  openAttachment(noteId: string, attachmentId: string): void;
  openLink(noteId: string, linkId: string): void;
}

/** What link chips and the link picker need from the window (D-098, D-156). */
export interface ReferenceHost {
  /** The current title of a live note, null when the note is in Trash or gone, undefined while the notes load. */
  titleOf(noteId: string): string | null | undefined;
  /**
   * The current title and kind of a live document as one stable object per tree state (a store snapshot); null when it
   * is in Trash or gone, undefined while the tree loads.
   */
  documentOf(documentId: string): { readonly label: string; readonly documentKind?: DocumentKind } | null | undefined;
  /** Called whenever titles may have changed. */
  subscribe(listener: () => void): () => void;
  /** Opens the note in a tab and reveals the block; a trashed, missing or changed target shows its own clear state. */
  open(noteId: string, blockId: string | null): void;
  /** Opens the document in a tab at the place (or its start); a trashed or missing one shows its own state. */
  openDocument(documentId: string, target: DocumentTargetType | null): void;
  /** Creates a note with the title next to the note being edited, for "Create note “…”"; null when it failed. */
  createNote(besideNoteId: string, title: string): Promise<{ id: string; title: string } | null>;
}
