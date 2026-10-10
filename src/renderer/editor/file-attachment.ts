import { ReactNodeViewRenderer } from '@tiptap/react';
import { FileAttachmentNode } from '../../shared/editor/nodes';
import { FileChipView } from './FileChipView';

/** Opening an attached file through main's validated OS hand-off (INF-REF-08). */
export interface FileActions {
  open(attachmentId: string): void;
  showInFolder(attachmentId: string): void;
  /** Opens a file of a document kind as a document in a tab (main window only, D-118). */
  openInApp?(attachmentId: string): void;
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
