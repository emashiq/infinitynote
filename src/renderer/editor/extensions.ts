import type { Extensions } from '@tiptap/core';
import { UniqueID } from '@tiptap/extension-unique-id';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { BLOCK_ID_TYPES } from '../../shared/editor/doc-schema';
import { PLAIN_STARTER_KIT, RICH_STARTER_KIT } from '../../shared/editor/schema';
import { TABLE_EXTENSIONS } from '../../shared/editor/tables';
import { TEXT_STYLE_EXTENSIONS } from '../../shared/editor/text-style';
import { createBlockIdGuard, isPasteOrDrop } from './block-id-guard';
import { isRemote } from './content';
import { createDocLimits } from './doc-limits';
import type { ReferenceHost } from './editor-services';
import { FileAttachment, type FileActions } from './file-attachment';
import { FileLink, type LinkActions } from './file-link';
import { FindExtension } from './find';
import { LongRuns } from './long-runs';
import { ManagedImage } from './managed-image';
import { NoteRef } from './note-ref';
import { ReminderChips } from './reminder-chips';
import { SuggestionDecorations } from './suggestions';
import { TaskToggle } from './task-toggle';
import type { AttachmentUploader } from './uploader';

export const PLACEHOLDER = 'Start writing…';

const newBlockId = () => crypto.randomUUID();

/**
 * The rich-note schema (D-053): StarterKit, checklists, app image, file and linked-file nodes (D-108), tables, character formatting (fonts,
 * sizes, colors), block IDs, find, size limits, the reminder chips (D-080), the reminder suggestion underlines (D-091)
 * and the wrapping of very long unbroken runs (F-03-1); the last three are decorations only. Note references and file hand-off (D-098) act only where the window
 * provides them. The schema is the shared one main applies live-sync steps with (D-103); another view's steps already
 * carry their block IDs.
 */
export function richExtensions(deps: {
  uploader: AttachmentUploader;
  notify: (message: string) => void;
  files: FileActions | null;
  links: LinkActions | null;
  references: ReferenceHost | null;
}): Extensions {
  return [
    StarterKit.configure(RICH_STARTER_KIT),
    TaskList,
    TaskItem.configure({ nested: true }),
    TaskToggle,
    ManagedImage,
    FileAttachment.configure({ files: deps.files }),
    FileLink.configure({ links: deps.links }),
    NoteRef.configure({ host: deps.references }),
    ...TABLE_EXTENSIONS,
    ...TEXT_STYLE_EXTENSIONS,
    // Pasted and dropped slices already carry fresh IDs (BlockIdGuard); UniqueID's pass over them is quadratic (QA-2).
    UniqueID.configure({ types: [...BLOCK_ID_TYPES], generateID: newBlockId, filterTransaction: (tr) => !isPasteOrDrop(tr) && !isRemote(tr) }),
    createBlockIdGuard(newBlockId),
    deps.uploader.extension(),
    createDocLimits(deps.notify),
    Placeholder.configure({ placeholder: PLACEHOLDER }),
    FindExtension,
    LongRuns,
    ReminderChips,
    SuggestionDecorations,
  ];
}

/** The plain-text schema: paragraphs of text only, stored as a string, one line per paragraph; suggestions too. */
export function plainExtensions(): Extensions {
  return [
    StarterKit.configure(PLAIN_STARTER_KIT),
    Placeholder.configure({ placeholder: PLACEHOLDER }),
    FindExtension,
    LongRuns,
    SuggestionDecorations,
  ];
}
