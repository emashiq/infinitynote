import { z } from 'zod';
import { DocumentTarget } from '../documents/targets';
import { DocumentKindSchema } from './hierarchy';
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
  documentTrashed: 'The linked document is in Trash',
  documentMissing: 'The linked document no longer exists',
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

/** A link from the note to a document, at a place inside it or not (D-156). */
export const OutgoingDocRef = z.strictObject({
  targetDocumentId: Uuid,
  target: DocumentTarget.nullable(),
  /** The document's current title, or the last title it had when it no longer exists. */
  title: z.string().max(200),
  /** The document's kind; null when it no longer exists. */
  kind: DocumentKindSchema.nullable(),
  path: z.array(z.string()),
  state: z.enum(['ok', 'trashed', 'missing']),
  trashBatchId: Uuid.nullable(),
});
export type OutgoingDocRefType = z.infer<typeof OutgoingDocRef>;

export const RefsListRequest = z.strictObject({ noteId: Uuid });
export const RefsListResponse = z.strictObject({
  outgoing: z.array(OutgoingRef).max(MAX_REF_ROWS),
  documents: z.array(OutgoingDocRef).max(MAX_REF_ROWS),
  backlinks: z.array(Backlink).max(MAX_REF_ROWS),
});

/** A live note linking to a document (D-156), with the place it links to. */
export const DocumentBacklink = z.strictObject({
  sourceNoteId: Uuid,
  sourceBlockId: Uuid.nullable(),
  target: DocumentTarget.nullable(),
  title: z.string().max(200),
  path: z.array(z.string()),
  context: z.string().max(MAX_REF_CONTEXT),
});
export type DocumentBacklinkType = z.infer<typeof DocumentBacklink>;

export const DocumentBacklinksRequest = z.strictObject({ documentId: Uuid });
export const DocumentBacklinksResponse = z.strictObject({ backlinks: z.array(DocumentBacklink).max(MAX_REF_ROWS) });
export type DocumentBacklinksResponseType = z.infer<typeof DocumentBacklinksResponse>;

/** Most items one link search answers with. */
export const MAX_LINK_RESULTS = 30;

/** The link picker's search over note and document titles (D-157). */
export const LinksSearchRequest = z.strictObject({ query: z.string().max(200), limit: z.number().int().min(1).max(MAX_LINK_RESULTS).optional() });
export const LinkCandidate = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('note'), id: Uuid, title: z.string(), path: z.array(z.string()), locked: z.boolean() }),
  z.strictObject({ kind: z.literal('document'), id: Uuid, title: z.string(), path: z.array(z.string()), documentKind: DocumentKindSchema }),
]);
export type LinkCandidateType = z.infer<typeof LinkCandidate>;
export const LinksSearchResponse = z.strictObject({ items: z.array(LinkCandidate).max(MAX_LINK_RESULTS) });
export type LinksSearchResponseType = z.infer<typeof LinksSearchResponse>;
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
