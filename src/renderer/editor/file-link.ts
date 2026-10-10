import { ReactNodeViewRenderer } from '@tiptap/react';
import type { AttachmentDtoType, FileLinkStatusType } from '../../shared/contracts/attachments';
import { FileLinkNode } from '../../shared/editor/nodes';
import { FileLinkView } from './FileLinkView';

/** A linked file through main's validated hand-off (D-108): the chip names its link ID, main looks up the path. */
export interface LinkActions {
  /** Where the link points and whether the file is there; null when main could not answer. */
  status(linkId: string): Promise<FileLinkStatusType | null>;
  /** Each resolves false after showing why it failed. */
  open(linkId: string): Promise<boolean>;
  showInFolder(linkId: string): Promise<boolean>;
  /** Copies the file into Infinity Notes; null after showing why it failed. */
  copyIn(linkId: string): Promise<AttachmentDtoType | null>;
  /** Opens a linked file of a document kind as a linked document in a tab (main window only, D-118). */
  openInApp?(linkId: string): void;
  /** The copy limit in bytes: larger linked files are not offered for copying. */
  copyLimitBytes(): number;
}

export interface FileLinkOptions {
  links: LinkActions | null;
}

/** The linked-file chip (D-108) with Open, Show in folder and Copy into Infinity Notes, which main validates. */
export const FileLink = FileLinkNode.extend<FileLinkOptions>({
  addOptions() {
    return { links: null };
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileLinkView);
  },
});
