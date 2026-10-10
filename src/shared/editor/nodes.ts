import { mergeAttributes, Node } from '@tiptap/core';
import { attachmentUrl } from '../app-identity';
import { UUID_RE } from '../contracts/ids';
import { DocumentTarget, type DocumentTargetType } from '../documents/targets';
import { IMAGE_SIZES } from './doc-schema';
import { refText } from './inline-text';

/**
 * The app's own node types without their views (D-053, D-098, D-103): the renderer adds the React views, and main
 * builds the same schema from them to apply editing steps (live sync).
 */

const intAttr = (value: string | null): number | null => {
  const n = value === null ? NaN : Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The text a link shows instead of its target's title (a linked selection, D-156). */
const aliasAttr = {
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute('data-alias') || null,
  renderHTML: (a: Record<string, unknown>) => (a.alias ? { 'data-alias': a.alias } : {}),
};

function parseTargetAttr(raw: string | null): DocumentTargetType | null {
  if (!raw) return null;
  try {
    const parsed = DocumentTarget.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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
 * A file linked at its original location, shown as a chip (D-108): the link ID and display facts only. The path stays in
 * main's database, so a document (or a paste) can never name a path that main would open.
 */
export const FileLinkNode = Node.create({
  name: 'fileLink',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      linkId: {
        default: null,
        parseHTML: (el) => uuidAttr(el, 'data-file-link-id'),
        renderHTML: (attrs) => (attrs.linkId ? { 'data-file-link-id': attrs.linkId } : {}),
      },
      name: { default: 'file', parseHTML: (el) => el.getAttribute('data-name') ?? el.textContent ?? 'file', renderHTML: (attrs) => ({ 'data-name': attrs.name }) },
      sizeBytes: {
        default: 0,
        parseHTML: (el) => Math.max(0, Number.parseInt(el.getAttribute('data-size') ?? '0', 10) || 0),
        renderHTML: (attrs) => ({ 'data-size': String(attrs.sizeBytes) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-file-link-id]', getAttrs: (el) => (uuidAttr(el as HTMLElement, 'data-file-link-id') ? null : false) }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'file-chip file-chip-linked' }), String(node.attrs.name)];
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
      label: { default: '', parseHTML: (el) => el.getAttribute('data-label') ?? el.textContent ?? '', renderHTML: (a) => ({ 'data-label': a.label }) },
      excerpt: { default: null, parseHTML: (el) => el.getAttribute('data-excerpt'), renderHTML: (a) => (a.excerpt ? { 'data-excerpt': a.excerpt } : {}) },
      alias: aliasAttr,
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-note-ref]', getAttrs: (el) => (uuidAttr(el as HTMLElement, 'data-note-ref') ? null : false) }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'note-ref' }), refText(node.attrs)];
  },

  renderText({ node }) {
    return refText(node.attrs);
  },
});

/**
 * An inline link to a document, optionally at a place inside it (F9, D-156): the document ID and the target only; the
 * label is the document's title when the link was made, shown only when the document is not live.
 */
export const DocRefNode = Node.create({
  name: 'docRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  marks: '',

  addAttributes() {
    return {
      documentId: { default: null, parseHTML: (el) => uuidAttr(el, 'data-doc-ref'), renderHTML: (a) => ({ 'data-doc-ref': a.documentId }) },
      target: {
        default: null,
        parseHTML: (el) => parseTargetAttr(el.getAttribute('data-doc-target')),
        renderHTML: (a) => (a.target ? { 'data-doc-target': JSON.stringify(a.target) } : {}),
      },
      label: { default: '', parseHTML: (el) => el.getAttribute('data-label') ?? el.textContent ?? '', renderHTML: (a) => ({ 'data-label': a.label }) },
      alias: aliasAttr,
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-doc-ref]', getAttrs: (el) => (uuidAttr(el as HTMLElement, 'data-doc-ref') ? null : false) }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'note-ref doc-ref' }), refText(node.attrs)];
  },

  renderText({ node }) {
    return refText(node.attrs);
  },
});

const latexAttr = {
  default: '',
  parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '',
  renderHTML: (a: Record<string, unknown>) => ({ 'data-latex': a.latex }),
};

/** Inline math (D-161): its TeX source only; the renderer draws it with KaTeX. */
export const MathInlineNode = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  marks: '',

  addAttributes() {
    return { latex: latexAttr };
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '', class: 'math-inline' }), String(node.attrs.latex)];
  },

  renderText({ node }) {
    return String(node.attrs.latex);
  },
});

/** Block math (D-161): a displayed formula from its TeX source. */
export const MathBlockNode = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return { latex: latexAttr };
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '', class: 'math-block' }), String(node.attrs.latex)];
  },

  renderText({ node }) {
    return String(node.attrs.latex);
  },
});
