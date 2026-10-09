import type { FolderTargetType } from '../../shared/contracts/hierarchy';
import type { BackupSummaryType } from '../../shared/contracts/portability';
import type { ReminderDtoType } from '../../shared/contracts/reminders';
import type { CardRequest } from '../reminders/card-request';
import { createStore, type Store } from './store';

export type DialogState =
  | { kind: 'newProject' }
  | { kind: 'newFolder'; target: FolderTargetType }
  | { kind: 'move'; key: string }
  | { kind: 'confirmTrash'; key: string }
  | { kind: 'confirmPurge'; batchId: string; count: number }
  | { kind: 'confirmEmptyTrash'; count: number }
  /** Add (reminder null) or edit a reminder of a note (plan section 9.7). */
  | { kind: 'reminder'; noteId: string; reminder: ReminderDtoType | null; blockId: string | null; title: string }
  /** The confirmation card of a reminder suggestion (plan section 9.6). */
  | { kind: 'suggestion'; request: CardRequest }
  /** Help menu (D-097). */
  | { kind: 'shortcuts' }
  | { kind: 'about' }
  /** "Lock note…" and the lock settings of a locked note (D-111). */
  | { kind: 'lockNote'; noteId: string }
  | { kind: 'lockSettings'; noteId: string }
  /** The confirmation of a checked backup before the app restarts to restore it (D-099). */
  | { kind: 'restoreBackup'; summary: BackupSummaryType };

export type FocusRequest =
  /** Renames the note in its tab (a new note, a double-click or F2 on the tab; D-102). */
  | { target: 'noteTitle'; noteId: string }
  | { target: 'noteFind'; noteId: string }
  /** Opens the reference picker of the note's editor (palette "Link to note…"). */
  | { target: 'noteReference'; noteId: string }
  | { target: 'treeRename'; key: string }
  | { target: 'tree' };

export interface UiState {
  dialog: DialogState | null;
  paletteOpen: boolean;
  /** The text the palette opens with (a missing reference's "Search" fills in its title). */
  paletteQuery: string;
  menu: { key: string; anchor: { x: number; y: number } } | null;
  focusRequest: FocusRequest | null;
  /** The tab whose label is being edited: the tab is the note's title (D-102). */
  renamingTab: string | null;
}

export class UiStore {
  readonly store: Store<UiState> = createStore<UiState>({
    dialog: null,
    paletteOpen: false,
    paletteQuery: '',
    menu: null,
    focusRequest: null,
    renamingTab: null,
  });

  openDialog(dialog: DialogState): void {
    this.store.setState({ dialog, menu: null });
  }
  closeDialog(): void {
    this.store.setState({ dialog: null });
  }
  openPalette(query = ''): void {
    this.store.setState({ paletteOpen: true, paletteQuery: query, menu: null });
  }
  closePalette(): void {
    this.store.setState({ paletteOpen: false });
  }
  openMenu(key: string, anchor: { x: number; y: number }): void {
    this.store.setState({ menu: { key, anchor } });
  }
  closeMenu(): void {
    this.store.setState({ menu: null });
  }
  startTabRename(tabId: string): void {
    this.store.setState({ renamingTab: tabId });
  }
  endTabRename(): void {
    if (this.store.getState().renamingTab !== null) this.store.setState({ renamingTab: null });
  }
  requestFocus(request: FocusRequest): void {
    this.store.setState({ focusRequest: request });
  }
  /** Returns the pending request and clears it. */
  consumeFocus(): FocusRequest | null {
    const request = this.store.getState().focusRequest;
    if (request) this.store.setState({ focusRequest: null });
    return request;
  }
}
