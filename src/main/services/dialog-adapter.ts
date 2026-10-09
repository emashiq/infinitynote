import { BrowserWindow, dialog, webContents } from 'electron';
import type { AttachmentKindType } from '../../shared/contracts/attachments';
import { closeChoiceFrom, type CloseChoice, type CloseDialogOptions } from './close-dialog';

export interface OpenFilesRequest {
  /** The window that asked; the dialog is modal to it. */
  webContentsId: number;
  kind: AttachmentKindType;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** A save, open-file or folder picker for backup, restore, export and import (D-099). */
export interface PathRequest {
  webContentsId: number;
  title: string;
  /** Save dialogs: the suggested file name. */
  defaultName?: string;
  filters?: FileFilter[];
}

/** Native dialogs. */
export interface DialogAdapter {
  /** File picker; resolves to the chosen paths, or null when the user canceled. */
  showOpenFiles(req: OpenFilesRequest): Promise<string[] | null>;
  /** The main-window close question (D-066), modal to the window of `parentWebContentsId`. */
  showCloseChoice(parentWebContentsId: number, options: CloseDialogOptions): Promise<CloseChoice>;
  /** Each resolves to the chosen path, or null when the user canceled. */
  showSaveFile(req: PathRequest): Promise<string | null>;
  showOpenFile(req: PathRequest): Promise<string | null>;
  showOpenFolder(req: PathRequest): Promise<string | null>;
}

const IMAGE_FILTER = { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] };

function windowOf(webContentsId: number): BrowserWindow | null {
  const sender = webContents.fromId(webContentsId);
  return sender ? BrowserWindow.fromWebContents(sender) : null;
}

async function openDialog(webContentsId: number, options: Electron.OpenDialogOptions): Promise<string[] | null> {
  const parent = windowOf(webContentsId);
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths;
}

export function createElectronDialogAdapter(): DialogAdapter {
  return {
    showOpenFiles: ({ webContentsId, kind }) =>
      openDialog(webContentsId, { properties: ['openFile', 'multiSelections'], filters: kind === 'image' ? [IMAGE_FILTER] : [] }),
    async showCloseChoice(parentWebContentsId, options) {
      const parent = windowOf(parentWebContentsId);
      const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      return closeChoiceFrom(result.response, result.checkboxChecked);
    },
    async showSaveFile({ webContentsId, title, defaultName, filters }) {
      const parent = windowOf(webContentsId);
      const options: Electron.SaveDialogOptions = { title, defaultPath: defaultName, filters, properties: ['showOverwriteConfirmation'] };
      const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
      return result.canceled || !result.filePath ? null : result.filePath;
    },
    showOpenFile: async ({ webContentsId, title, filters }) => (await openDialog(webContentsId, { title, filters, properties: ['openFile'] }))?.[0] ?? null,
    showOpenFolder: async ({ webContentsId, title }) =>
      (await openDialog(webContentsId, { title, properties: ['openDirectory', 'createDirectory'] }))?.[0] ?? null,
  };
}
