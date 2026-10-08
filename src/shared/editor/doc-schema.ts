import { UUID_RE } from '../contracts/ids';
import { parseExternalUrl } from '../url-policy';

/**
 * The rich-note document schema shared by the editor (renderer) and the note writer (main), D-053.
 * `normalizeRichDoc` is the gate every stored rich document passes: whitelisted node and mark types, known
 * attributes only, bounded depth and size. It is pure and idempotent.
 */

/** A ProseMirror JSON document as stored for rich notes. */
export interface RichDocLike {
  type: 'doc';
  content?: unknown[];
  [key: string]: unknown;
}

export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: RichMark[];
  text?: string;
}

export interface RichMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** Node types that carry a stable block `id` (UniqueID and BlockIdGuard). */
export const BLOCK_ID_TYPES = ['paragraph', 'heading', 'codeBlock', 'blockquote', 'listItem', 'taskItem', 'image', 'fileAttachment'] as const;

export const IMAGE_SIZES = ['small', 'medium', 'full'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const MAX_DOC_DEPTH = 64;
export const MAX_DOC_NODES = 100_000;

const BLOCK = ['paragraph', 'heading', 'codeBlock', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'horizontalRule', 'image', 'fileAttachment'];
const INLINE = ['text', 'hardBreak'];

/** Allowed child types per node type; an empty list is a leaf. */
const CHILDREN: Record<string, readonly string[]> = {
  doc: BLOCK,
  paragraph: INLINE,
  heading: INLINE,
  codeBlock: ['text'],
  blockquote: BLOCK,
  bulletList: ['listItem'],
  orderedList: ['listItem'],
  taskList: ['taskItem'],
  listItem: BLOCK,
  taskItem: BLOCK,
  horizontalRule: [],
  hardBreak: [],
  image: [],
  fileAttachment: [],
  text: [],
};

export const RICH_NODE_TYPES = Object.keys(CHILDREN);
export const RICH_MARK_TYPES = ['bold', 'italic', 'strike', 'underline', 'code', 'link'] as const;

export class DocSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocSchemaError';
  }
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const intIn = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const shortString = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

/** Attributes kept per node type (section 9.1 of the Phase 03 plan); `undefined` values are omitted. */
function nodeAttrs(type: string, raw: Json): Json {
  const id = isUuid(raw.id) ? raw.id : undefined;
  switch (type) {
    case 'paragraph':
    case 'blockquote':
    case 'listItem':
      return { id };
    case 'heading':
      if (!intIn(raw.level, 1, 3)) throw new DocSchemaError('Heading level must be 1, 2 or 3');
      return { id, level: raw.level };
    case 'codeBlock':
      return { id, language: shortString(raw.language, 32) };
    case 'orderedList':
      return { start: intIn(raw.start, 0, Number.MAX_SAFE_INTEGER) ? raw.start : 1, type: shortString(raw.type, 8) };
    case 'taskItem':
      return { id, checked: raw.checked === true };
    case 'image': {
      if (!isUuid(raw.attachmentId)) throw new DocSchemaError('Image without an attachment');
      const size = (IMAGE_SIZES as readonly unknown[]).includes(raw.size) ? raw.size : 'medium';
      const dim = (v: unknown) => (intIn(v, 1, 100_000) ? v : null);
      return { id, attachmentId: raw.attachmentId, alt: shortString(raw.alt, 500), size, width: dim(raw.width), height: dim(raw.height) };
    }
    case 'fileAttachment': {
      if (!isUuid(raw.attachmentId)) throw new DocSchemaError('File without an attachment');
      if (typeof raw.name !== 'string' || raw.name.length < 1 || raw.name.length > 255) throw new DocSchemaError('File name is invalid');
      if (!intIn(raw.sizeBytes, 0, Number.MAX_SAFE_INTEGER)) throw new DocSchemaError('File size is invalid');
      const mime = shortString(raw.mime, 100);
      if (mime === null) throw new DocSchemaError('File type is invalid');
      return { id, attachmentId: raw.attachmentId, name: raw.name, sizeBytes: raw.sizeBytes, mime };
    }
    default:
      return {};
  }
}

function withoutUndefined(attrs: Json): Json | undefined {
  const out: Json = {};
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Keeps known marks; a link whose address is not http(s) is dropped (its text stays). */
function normalizeMarks(raw: unknown): RichMark[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new DocSchemaError('Marks must be a list');
  const out: RichMark[] = [];
  for (const m of raw) {
    if (!isObject(m) || typeof m.type !== 'string') throw new DocSchemaError('Mark without a type');
    if (!(RICH_MARK_TYPES as readonly string[]).includes(m.type)) throw new DocSchemaError(`Unknown mark type: ${m.type}`);
    if (out.some((x) => x.type === m.type)) continue;
    if (m.type === 'link') {
      const href = isObject(m.attrs) ? m.attrs.href : undefined;
      if (typeof href === 'string' && parseExternalUrl(href).ok) out.push({ type: 'link', attrs: { href } });
    } else {
      out.push({ type: m.type });
    }
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Validates and normalizes a rich document. Throws DocSchemaError for an unknown node or mark type, a node in a
 * place the schema does not allow, a missing required attribute, depth over 64 or more than 100,000 nodes.
 */
export function normalizeRichDoc(doc: unknown): RichDocLike {
  let count = 0;

  const visit = (raw: unknown, depth: number, allowed: readonly string[]): RichNode | null => {
    if (!isObject(raw) || typeof raw.type !== 'string') throw new DocSchemaError('Node without a type');
    const type = raw.type;
    const children = CHILDREN[type];
    if (!children) throw new DocSchemaError(`Unknown node type: ${type}`);
    if (!allowed.includes(type)) throw new DocSchemaError(`A ${type} node is not allowed here`);
    if (depth > MAX_DOC_DEPTH) throw new DocSchemaError('The document is nested too deeply');
    count += 1;
    if (count > MAX_DOC_NODES) throw new DocSchemaError('The document has too many parts');

    if (type === 'text') {
      if (typeof raw.text !== 'string') throw new DocSchemaError('Text node without text');
      if (raw.text === '') return null;
      const marks = normalizeMarks(raw.marks);
      return marks ? { type, text: raw.text, marks } : { type, text: raw.text };
    }
    const node: RichNode = { type };
    const attrs = withoutUndefined(nodeAttrs(type, isObject(raw.attrs) ? raw.attrs : {}));
    if (attrs) node.attrs = attrs;
    const content = visitContent(raw.content, depth, children);
    if (content) node.content = content;
    return node;
  };

  const visitContent = (raw: unknown, depth: number, allowed: readonly string[]): RichNode[] | undefined => {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) throw new DocSchemaError('Content must be a list');
    if (raw.length > 0 && allowed.length === 0) throw new DocSchemaError('A leaf node cannot have content');
    const out: RichNode[] = [];
    for (const child of raw) {
      const n = visit(child, depth + 1, allowed);
      if (n) out.push(n);
    }
    return out.length > 0 ? out : undefined;
  };

  if (!isObject(doc) || doc.type !== 'doc') throw new DocSchemaError('Not a document');
  const content = visitContent(doc.content, 0, CHILDREN.doc!);
  return content ? { type: 'doc', content } : { type: 'doc' };
}

export interface AttachmentRef {
  attachmentId: string;
  blockId: string | null;
}

/** Every image and file reference in a document (tolerates unnormalized input), in document order. */
export function collectAttachmentRefs(doc: unknown): AttachmentRef[] {
  const refs: AttachmentRef[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (!isObject(node) || depth > MAX_DOC_DEPTH) return;
    if ((node.type === 'image' || node.type === 'fileAttachment') && isObject(node.attrs) && isUuid(node.attrs.attachmentId)) {
      refs.push({ attachmentId: node.attrs.attachmentId, blockId: isUuid(node.attrs.id) ? node.attrs.id : null });
    }
    if (Array.isArray(node.content)) for (const child of node.content) walk(child, depth + 1);
  };
  walk(doc, 0);
  return refs;
}
