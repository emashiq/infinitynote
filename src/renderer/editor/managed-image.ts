import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { attachmentUrl } from '../../shared/app-identity';
import { UUID_RE } from '../../shared/contracts/ids';
import { IMAGE_SIZES, type ImageSize } from '../../shared/editor/doc-schema';
import { ImageView } from './ImageView';

const intAttr = (value: string | null): number | null => {
  const n = value === null ? NaN : Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    managedImage: {
      /** Sets the display size preset of the selected image. */
      setImageSize: (size: ImageSize) => ReturnType;
    };
  }
}

/**
 * The app image node (D-053): it stores an attachment ID, never a URL, and loads through the attachment
 * protocol. It parses only our own copies (`img[data-attachment-id]`) and pasted data images that the sanitizer
 * turned into upload placeholders (`img[data-upload-token]`); any other image is never an image node.
 */
export const ManagedImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (el) => {
          const id = el.getAttribute('data-attachment-id');
          return id && UUID_RE.test(id) ? id : null;
        },
        renderHTML: (attrs) => (attrs.attachmentId ? { 'data-attachment-id': attrs.attachmentId, src: attachmentUrl(attrs.attachmentId as string) } : {}),
      },
      alt: { default: null, parseHTML: (el) => el.getAttribute('alt'), renderHTML: (attrs) => (attrs.alt ? { alt: attrs.alt } : {}) },
      size: {
        default: 'medium',
        parseHTML: (el) => IMAGE_SIZES.find((s) => el.classList.contains(`img-${s}`)) ?? 'medium',
        renderHTML: (attrs) => ({ class: `img-${String(attrs.size)}` }),
      },
      width: { default: null, parseHTML: (el) => intAttr(el.getAttribute('width')) },
      height: { default: null, parseHTML: (el) => intAttr(el.getAttribute('height')) },
      /** Set while the bytes are being imported; never saved (toSavable drops such nodes). */
      uploadToken: { default: null, rendered: false, parseHTML: (el) => el.getAttribute('data-upload-token') },
    };
  },

  parseHTML() {
    return [
      { tag: 'img[data-attachment-id]', getAttrs: (el) => (UUID_RE.test((el as HTMLElement).getAttribute('data-attachment-id') ?? '') ? null : false) },
      { tag: 'img[data-upload-token]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },

  addCommands() {
    return {
      setImageSize:
        (size) =>
        ({ commands }) =>
          commands.updateAttributes('image', { size }),
    };
  },
});
