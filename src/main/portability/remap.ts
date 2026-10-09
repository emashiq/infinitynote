import { BLOCK_ID_TYPES, collectBlockIds, normalizeRichDoc, type RichDocLike, type RichNode } from '../../shared/editor/doc-schema';

/** Fresh IDs for one import (INF-PORT-04): every project, folder, note, block, attachment and linked file gets a new ID. */
export interface IdRemap {
  /** The new ID of an imported item, created on first use; an ID outside the archive also gets a stable fresh ID. */
  item(oldId: string): string;
  /** The new ID of a block of an imported note, or null when that note or block is not in the archive. */
  block(oldNoteId: string, oldBlockId: string): string | null;
  /** The stored attachment for an archived one, or null when it could not be imported. */
  attachment(oldId: string): string | null;
  /** The new ID of an archived linked file (D-108), or null when the archive does not list it. */
  link(oldId: string): string | null;
}

export function createIdRemap(deps: {
  uuid: () => string;
  /** Block IDs of every archived rich note, read before any rewrite. */
  blocksByNote: ReadonlyMap<string, ReadonlySet<string>>;
  attachments: ReadonlyMap<string, string>;
  links: ReadonlyMap<string, string>;
}): IdRemap {
  const items = new Map<string, string>();
  const blocks = new Map<string, string>();
  const item = (oldId: string): string => {
    let id = items.get(oldId);
    if (!id) {
      id = deps.uuid();
      items.set(oldId, id);
    }
    return id;
  };
  return {
    item,
    block(oldNoteId, oldBlockId) {
      if (!deps.blocksByNote.get(oldNoteId)?.has(oldBlockId)) return null;
      const key = `${oldNoteId}:${oldBlockId}`;
      let id = blocks.get(key);
      if (!id) {
        id = deps.uuid();
        blocks.set(key, id);
      }
      return id;
    },
    attachment: (oldId) => deps.attachments.get(oldId) ?? null,
    link: (oldId) => deps.links.get(oldId) ?? null,
  };
}

/** Block IDs of an archived rich document (empty for content that fails the schema; it is refused later). */
export function archivedBlockIds(content: unknown): Set<string> {
  try {
    return collectBlockIds(normalizeRichDoc(content));
  } catch {
    return new Set();
  }
}

const BLOCK_TYPES: ReadonlySet<string> = new Set(BLOCK_ID_TYPES);

/**
 * Rewrites an archived rich document for its new note: block IDs, `noteRef` targets (a target outside the archive keeps
 * its label and shows as missing, never aliasing a local note), attachment IDs and link IDs. Images and files whose
 * attachment could not be imported, and linked files the archive does not list, are dropped, since a node must name a
 * stored attachment or link.
 */
export function remapRichDoc(doc: RichDocLike, oldNoteId: string, remap: IdRemap): RichDocLike {
  const rewrite = (node: RichNode): RichNode | null => {
    const attrs = node.attrs ? { ...node.attrs } : undefined;
    if (attrs) {
      if (BLOCK_TYPES.has(node.type) && typeof attrs.id === 'string') attrs.id = remap.block(oldNoteId, attrs.id) ?? undefined;
      if ((node.type === 'image' || node.type === 'fileAttachment') && typeof attrs.attachmentId === 'string') {
        const attachmentId = remap.attachment(attrs.attachmentId);
        if (!attachmentId) return null;
        attrs.attachmentId = attachmentId;
      }
      if (node.type === 'fileLink' && typeof attrs.linkId === 'string') {
        const linkId = remap.link(attrs.linkId);
        if (!linkId) return null;
        attrs.linkId = linkId;
      }
      if (node.type === 'noteRef' && typeof attrs.noteId === 'string') {
        const target = attrs.noteId;
        attrs.noteId = remap.item(target);
        attrs.blockId = typeof attrs.blockId === 'string' ? remap.block(target, attrs.blockId) : null;
      }
    }
    const content = node.content?.map(rewrite).filter((c): c is RichNode => c !== null);
    return { ...node, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) };
  };
  const content = (doc.content as RichNode[] | undefined)?.map(rewrite).filter((c): c is RichNode => c !== null);
  return normalizeRichDoc({ ...doc, content: content && content.length > 0 ? content : [{ type: 'paragraph' }] });
}
