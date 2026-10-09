import { mergeAttributes, Node } from '@tiptap/core';
import { attachmentUrl } from '../app-identity';
import { UUID_RE } from '../contracts/ids';
import { IMAGE_SIZES } from './doc-schema';

/**
 * The app's own node types without their views (D-053, D-098, D-103): the renderer adds the React views, and main
 * builds the same schema from them to apply editing steps (live sync).
 */

const intAttr = (value: string | null): number | null => {
  const n = value === null ? NaN : Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const uuidAttr = (el: HTMLElement, name: string): string | null => {
  const v = el.getAttribute(name);
  return v && UUID_RE.test(v) ? v : null;
};

/**
 * The app image node: it stores an attachment ID, never a URL, and loads through the attachment protocol. It parses
 * only our own copies (`img[data-attachment-id]`) and pasted data images that the sanitizer turned into upload
 * placeholders (`img[data-upload-token]`); any other image is never an image node.
 */
export const ImageNode = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (el) => uuidAttr(el, 'data-attachment-id'),
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
      { tag: 'img[data-attachment-id]', getAttrs: (el) => (uuidAttr(el as HTMLElement, 'data-attachment-id') ? null : false) },
      { tag: 'img[data-upload-token]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },
});

/** A managed document shown as a chip (INF-EDIT-14): the attachment ID and display facts only. */
export const FileAttachmentNode = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (el) => uuidAttr(el, 'data-file-attachment-id'),
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
    return [{ tag: 'div[data-file-attachment-id]', getAttrs: (el) => (uuidAttr(el as HTMLElement, 'data-file-attachment-id') ? null : false) }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'file-chip' }), String(node.attrs.name)];
  },
});

/**
 * An inline link to another note or one of its blocks (INF-REF-01, INF-REF-02): IDs only; the label and excerpt are
 * what the target looked like when inserted and are shown only when the target is not live.
 */
export const NoteRefNode = Node.create({
  name: 'noteRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  marks: '',

  addAttributes() {
    return {
      noteId: { default: null, parseHTML: (el) => uuidAttr(el, 'data-note-ref'), renderHTML: (a) => ({ 'data-note-ref': a.noteId }) },
      blockId: { default: null, parseHTML: (el) => uuidAttr(el, 'data-block-ref'), renderHTML: (a) => (a.blockId ? { 'data-block-ref': a.blockId } : {}) },
      label: { default: '', parseHTML: (el) => el.textContent ?? '', renderHTML: () => ({}) },
      excerpt: { default: null, parseHTML: (el) => el.getAttribute('data-excerpt'), renderHTML: (a) => (a.excerpt ? { 'data-excerpt': a.excerpt } : {}) },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-note-ref]', getAttrs: (el) => (uuidAttr(el as HTMLElement, 'data-note-ref') ? null : false) }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'note-ref' }), String(node.attrs.label)];
  },

  renderText({ node }) {
    return String(node.attrs.label);
  },
});
