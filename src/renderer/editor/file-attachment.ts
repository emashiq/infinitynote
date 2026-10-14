import { ReactNodeViewRenderer } from '@tiptap/react';
import { FileAttachmentNode } from '../../shared/editor/nodes';
import { FileChipView } from './FileChipView';

/** Opens an attached or linked file as a document in a tab, for the kinds the app opens with the current settings. */
export interface InAppOpener {
  opens(name: string): boolean;
  open(id: string): void;
}

/** Opening an attached file through main's validated OS hand-off (INF-REF-08). */
export interface FileActions {
  open(attachmentId: string): void;
  showInFolder(attachmentId: string): void;
  /** "Open in Infinity Notes" (main window only, D-118) for the files the app opens as documents now (D-187). */
  inApp?: InAppOpener;
}

export interface FileAttachmentOptions {
  files: FileActions | null;
}

/** The file chip (INF-EDIT-14) with Open and Show in folder, which main validates (D-098). */
export const FileAttachment = FileAttachmentNode.extend<FileAttachmentOptions>({
  addOptions() {
    return { files: null };
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileChipView);
  },
});
