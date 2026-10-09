import { z } from 'zod';
import { Uuid } from './ids';

/** Most references and backlinks one `refs:list` answer carries (each list). */
export const MAX_REF_ROWS = 200;
/** Most blocks `notes:pick` lists for one note. */
export const MAX_PICK_BLOCKS = 200;
/** Longest block text shown in the panel or the picker. */
export const MAX_REF_CONTEXT = 160;

/**
 * Where a reference points (INF-REF-06): the live note (and block), a note whose block is gone, a note in Trash,
 * or a purged note. A reference is never redirected to something else.
 */
export const RefTargetState = z.enum(['ok', 'blockMissing', 'trashed', 'missing']);
export type RefTargetStateType = z.infer<typeof RefTargetState>;

export const REF_MESSAGES = {
  trashed: 'The linked note is in Trash',
  missing: 'The linked note no longer exists',
} as const;

export const OutgoingRef = z.strictObject({
  targetNoteId: Uuid,
  targetBlockId: Uuid.nullable(),
  /** The target's current title, or the last title it had when it no longer exists. */
  title: z.string().max(200),
  path: z.array(z.string()),
  state: RefTargetState,
  /** The Trash batch to restore a trashed target from. */
  trashBatchId: Uuid.nullable(),
  /** The text of the target block when it is still there. */
  blockText: z.string().max(MAX_REF_CONTEXT).nullable(),
});
export type OutgoingRefType = z.infer<typeof OutgoingRef>;

export const Backlink = z.strictObject({
  sourceNoteId: Uuid,
  sourceBlockId: Uuid.nullable(),
  targetBlockId: Uuid.nullable(),
  title: z.string().max(200),
  path: z.array(z.string()),
  /** The text of the block that holds the reference. */
  context: z.string().max(MAX_REF_CONTEXT),
});
export type BacklinkType = z.infer<typeof Backlink>;

export const RefsListRequest = z.strictObject({ noteId: Uuid });
export const RefsListResponse = z.strictObject({
  outgoing: z.array(OutgoingRef).max(MAX_REF_ROWS),
  backlinks: z.array(Backlink).max(MAX_REF_ROWS),
});
export type RefsListResponseType = z.infer<typeof RefsListResponse>;

/** The blocks of one note a reference can point to (the picker's second step). */
export const NotesPickRequest = z.strictObject({ noteId: Uuid, query: z.string().max(200) });
export const PickBlock = z.strictObject({
  blockId: Uuid,
  kind: z.enum(['paragraph', 'heading', 'codeBlock']),
  text: z.string().max(MAX_REF_CONTEXT),
});
export type PickBlockType = z.infer<typeof PickBlock>;
export const NotesPickResponse = z.strictObject({
  format: z.enum(['rich', 'plain']),
  blocks: z.array(PickBlock).max(MAX_PICK_BLOCKS),
});
export type NotesPickResponseType = z.infer<typeof NotesPickResponse>;
