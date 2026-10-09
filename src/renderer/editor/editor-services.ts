import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { SuggestionContext } from '../reminders/suggestion-context';
import type { AttachmentLimits } from './uploader';

/**
 * What the editor needs from the app; passed in so the same editor serves tabs and (Phase 04) stickies. Must be a
 * stable object (each editor instance creates its uploader from it once).
 */
export interface EditorServices {
  bridge: Pick<InfinityBridge, 'attachment' | 'shell' | 'palette' | 'notes'>;
  notify: (message: string) => void;
  limits: () => AttachmentLimits;
  /** Reminder suggestions: main's reference context, dismissals and the suggestion settings (D-091). */
  suggestions: SuggestionContext;
  /** Note references (main window only): live titles for the chips and opening a reference in a tab. */
  references?: ReferenceHost;
}

/** What reference chips and the reference picker need from the window (D-098). */
export interface ReferenceHost {
  /** The current title of a live note, null when the note is in Trash or gone, undefined while the notes load. */
  titleOf(noteId: string): string | null | undefined;
  /** Called whenever titles may have changed. */
  subscribe(listener: () => void): () => void;
  /** Opens the note in a tab and reveals the block; a trashed, missing or changed target shows its own clear state. */
  open(noteId: string, blockId: string | null): void;
}
