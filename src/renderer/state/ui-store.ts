import type { FolderTargetType } from '../../shared/contracts/hierarchy';
import { createStore, type Store } from './store';

export type DialogState =
  | { kind: 'newProject' }
  | { kind: 'newFolder'; target: FolderTargetType }
  | { kind: 'move'; key: string }
  | { kind: 'confirmTrash'; key: string }
  | { kind: 'confirmPurge'; batchId: string; count: number }
  | { kind: 'confirmEmptyTrash'; count: number };

export type FocusRequest =
  | { target: 'noteTitle'; noteId: string }
  | { target: 'treeRename'; key: string }
  | { target: 'tree' };

export interface UiState {
  dialog: DialogState | null;
  paletteOpen: boolean;
  menu: { key: string; anchor: { x: number; y: number } } | null;
  focusRequest: FocusRequest | null;
}

export class UiStore {
  readonly store: Store<UiState> = createStore<UiState>({ dialog: null, paletteOpen: false, menu: null, focusRequest: null });

  openDialog(dialog: DialogState): void {
    this.store.setState({ dialog, menu: null });
  }
  closeDialog(): void {
    this.store.setState({ dialog: null });
  }
  openPalette(): void {
    this.store.setState({ paletteOpen: true, menu: null });
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
