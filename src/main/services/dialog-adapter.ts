import { BrowserWindow, dialog, webContents } from 'electron';
import type { AttachmentKindType } from '../../shared/contracts/attachments';

export interface OpenFilesRequest {
  /** The window that asked; the dialog is modal to it. */
  webContentsId: number;
  kind: AttachmentKindType;
}

/** Native file pickers. Resolves to the chosen paths, or null when the user canceled. */
export interface DialogAdapter {
  showOpenFiles(req: OpenFilesRequest): Promise<string[] | null>;
}

const IMAGE_FILTER = { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] };

export function createElectronDialogAdapter(): DialogAdapter {
  return {
    async showOpenFiles({ webContentsId, kind }) {
      const sender = webContents.fromId(webContentsId);
      const parent = sender ? BrowserWindow.fromWebContents(sender) : null;
      const options: Electron.OpenDialogOptions = {
        properties: ['openFile', 'multiSelections'],
        filters: kind === 'image' ? [IMAGE_FILTER] : [],
      };
      const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths;
    },
  };
}
