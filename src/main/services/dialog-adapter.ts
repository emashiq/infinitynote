import { BrowserWindow, dialog, webContents } from 'electron';
import type { AttachmentKindType } from '../../shared/contracts/attachments';
import { closeChoiceFrom, type CloseChoice, type CloseDialogOptions } from './close-dialog';

export interface OpenFilesRequest {
  /** The window that asked; the dialog is modal to it. */
  webContentsId: number;
  kind: AttachmentKindType;
}

/** Native dialogs. */
export interface DialogAdapter {
  /** File picker; resolves to the chosen paths, or null when the user canceled. */
  showOpenFiles(req: OpenFilesRequest): Promise<string[] | null>;
  /** The main-window close question (D-066), modal to the window of `parentWebContentsId`. */
  showCloseChoice(parentWebContentsId: number, options: CloseDialogOptions): Promise<CloseChoice>;
}

const IMAGE_FILTER = { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] };

function windowOf(webContentsId: number): BrowserWindow | null {
  const sender = webContents.fromId(webContentsId);
  return sender ? BrowserWindow.fromWebContents(sender) : null;
}

export function createElectronDialogAdapter(): DialogAdapter {
  return {
    async showOpenFiles({ webContentsId, kind }) {
      const parent = windowOf(webContentsId);
      const options: Electron.OpenDialogOptions = {
        properties: ['openFile', 'multiSelections'],
        filters: kind === 'image' ? [IMAGE_FILTER] : [],
      };
      const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths;
    },
    async showCloseChoice(parentWebContentsId, options) {
      const parent = windowOf(parentWebContentsId);
      const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      return closeChoiceFrom(result.response, result.checkboxChecked);
    },
  };
}
