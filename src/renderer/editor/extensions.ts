import type { Extensions } from '@tiptap/core';
import { UniqueID } from '@tiptap/extension-unique-id';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { BLOCK_ID_TYPES } from '../../shared/editor/doc-schema';
import { parseExternalUrl } from '../../shared/url-policy';
import { createBlockIdGuard, isPasteOrDrop } from './block-id-guard';
import { createDocLimits } from './doc-limits';
import { FileAttachment } from './file-attachment';
import { FindExtension } from './find';
import { ManagedImage } from './managed-image';
import { ReminderChips } from './reminder-chips';
import { TaskToggle } from './task-toggle';
import type { AttachmentUploader } from './uploader';

export const PLACEHOLDER = 'Start writing…';
export const UNDO_DEPTH = 200;

const newBlockId = () => crypto.randomUUID();

/**
 * The rich-note schema (D-053): StarterKit, checklists, app image and file nodes, block IDs, find, size limits, and the
 * reminder chips (decorations only, D-080).
 */
export function richExtensions(deps: { uploader: AttachmentUploader; notify: (message: string) => void }): Extensions {
  return [
    StarterKit.configure({
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
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TaskToggle,
    ManagedImage,
    FileAttachment,
    // Pasted and dropped slices already carry fresh IDs (BlockIdGuard); UniqueID's pass over them is quadratic (QA-2).
    UniqueID.configure({ types: [...BLOCK_ID_TYPES], generateID: newBlockId, filterTransaction: (tr) => !isPasteOrDrop(tr) }),
    createBlockIdGuard(newBlockId),
    deps.uploader.extension(),
    createDocLimits(deps.notify),
    Placeholder.configure({ placeholder: PLACEHOLDER }),
    FindExtension,
    ReminderChips,
  ];
}

/** The plain-text schema: paragraphs of text only, stored as a string, one line per paragraph. */
export function plainExtensions(): Extensions {
  return [
    StarterKit.configure({
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
    }),
    Placeholder.configure({ placeholder: PLACEHOLDER }),
    FindExtension,
  ];
}
