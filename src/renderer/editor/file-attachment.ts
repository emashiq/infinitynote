import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { UUID_RE } from '../../shared/contracts/ids';
import { FileChipView } from './FileChipView';

/** Opening an attached file through main's validated OS hand-off (INF-REF-08). */
export interface FileActions {
  open(attachmentId: string): void;
  showInFolder(attachmentId: string): void;
}

export interface FileAttachmentOptions {
  files: FileActions | null;
}

/**
 * A managed document shown as a chip (INF-EDIT-14). Only the attachment ID and display facts are stored; the chip
 * offers Open and Show in folder, which main validates (D-098).
 */
export const FileAttachment = Node.create<FileAttachmentOptions>({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { files: null };
  },

  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (el) => {
          const id = el.getAttribute('data-file-attachment-id');
          return id && UUID_RE.test(id) ? id : null;
        },
        renderHTML: (attrs) => (attrs.attachmentId ? { 'data-file-attachment-id': attrs.attachmentId } : {}),
      },
      name: { default: 'file', parseHTML: (el) => el.getAttribute('data-name') ?? el.textContent ?? 'file', renderHTML: (attrs) => ({ 'data-name': attrs.name }) },
      sizeBytes: {
        default: 0,
        parseHTML: (el) => Math.max(0, Number.parseInt(el.getAttribute('data-size') ?? '0', 10) || 0),
        renderHTML: (attrs) => ({ 'data-size': String(attrs.sizeBytes) }),
      },
      mime: { default: 'application/octet-stream', parseHTML: (el) => el.getAttribute('data-mime') ?? 'application/octet-stream', renderHTML: (attrs) => ({ 'data-mime': attrs.mime }) },
      /** Set while the bytes are being imported; never saved. */
      uploadToken: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-file-attachment-id]', getAttrs: (el) => (UUID_RE.test((el as HTMLElement).getAttribute('data-file-attachment-id') ?? '') ? null : false) }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'file-chip' }), String(node.attrs.name)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileChipView);
  },
});
