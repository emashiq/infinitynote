import { getSchema, type Extensions } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { UniqueID } from '@tiptap/extension-unique-id';
import type { Schema } from '@tiptap/pm/model';
import StarterKit, { type StarterKitOptions } from '@tiptap/starter-kit';
import { parseExternalUrl } from '../url-policy';
import { BLOCK_ID_TYPES } from './doc-schema';
import { FileAttachmentNode, ImageNode, NoteRefNode } from './nodes';

export const UNDO_DEPTH = 200;

/** StarterKit as rich notes use it (D-053): headings 1-3 and http(s) links that open only on request. */
export const RICH_STARTER_KIT: Partial<StarterKitOptions> = {
  heading: { levels: [1, 2, 3] },
  link: {
    openOnClick: false,
    autolink: true,
    linkOnPaste: true,
    protocols: [],
    defaultProtocol: 'https',
    isAllowedUri: (url) => parseExternalUrl(url).ok,
    HTMLAttributes: { target: null, rel: 'noopener noreferrer nofollow' },
  },
  undoRedo: { depth: UNDO_DEPTH },
};

/** StarterKit as plain-text notes use it: paragraphs of text only. */
export const PLAIN_STARTER_KIT: Partial<StarterKitOptions> = {
  blockquote: false,
  bold: false,
  bulletList: false,
  code: false,
  codeBlock: false,
  dropcursor: false,
  gapcursor: false,
  hardBreak: false,
  heading: false,
  horizontalRule: false,
  italic: false,
  listItem: false,
  listKeymap: false,
  link: false,
  orderedList: false,
  strike: false,
  underline: false,
  trailingNode: false,
  undoRedo: { depth: UNDO_DEPTH },
};

let rich: Schema | null = null;
let plain: Schema | null = null;

/**
 * The schema of a note format exactly as the editor builds it (the editor adds views and plugins, which do not change
 * it). Main applies the editing steps of live sync with it (D-103).
 */
export function noteSchema(format: 'rich' | 'plain'): Schema {
  if (format === 'plain') return (plain ??= getSchema([StarterKit.configure(PLAIN_STARTER_KIT)]));
  const extensions: Extensions = [
    StarterKit.configure(RICH_STARTER_KIT),
    TaskList,
    TaskItem.configure({ nested: true }),
    ImageNode,
    FileAttachmentNode,
    NoteRefNode,
    UniqueID.configure({ types: [...BLOCK_ID_TYPES] }),
  ];
  return (rich ??= getSchema(extensions));
}
