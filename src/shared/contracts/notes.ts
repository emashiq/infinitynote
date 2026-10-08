import { z } from 'zod';
import { NoteSummary } from './hierarchy';
import { Uuid } from './ids';

/** A save that fails with INTERNAL is retried this often, this far apart (the renderer), before it gives up. */
export const SAVE_RETRIES = 3;
export const SAVE_RETRY_DELAY_MS = 1000;

export const MAX_CONTENT_BYTES = 5 * 1024 * 1024;

export const RichDoc = z.looseObject({ type: z.literal('doc'), content: z.array(z.unknown()).optional() });

export const NoteSaveRequest = z
  .strictObject({
    noteId: Uuid,
    viewId: Uuid,
    leaseToken: Uuid,
    baseRevision: z.number().int().min(0),
    requestId: Uuid,
    title: z.string().max(200).optional(),
    format: z.enum(['rich', 'plain']),
    content: z.union([RichDoc, z.string()]),
  })
  .superRefine((req, ctx) => {
    if (req.format === 'rich' && typeof req.content === 'string') {
      ctx.addIssue({ code: 'custom', path: ['content'], message: 'Rich notes require a document object' });
    }
    if (req.format === 'plain' && typeof req.content !== 'string') {
      ctx.addIssue({ code: 'custom', path: ['content'], message: 'Plain notes require a string' });
    }
  });
export type NoteSaveRequestType = z.infer<typeof NoteSaveRequest>;

/** Shown when a save is refused because the content is over MAX_CONTENT_BYTES. */
export const NOTE_TOO_LARGE_MESSAGE = 'This note is too large to save (over 5 MB). Remove some content to keep editing safely.';

export const NoteSaveAck = z.strictObject({
  noteId: Uuid,
  revision: z.number().int().min(0),
  requestId: Uuid,
  updatedAt: z.number().int(),
});
export type NoteSaveAckType = z.infer<typeof NoteSaveAck>;

/** Details of a CONFLICT error. Content operations (conversion, restores) submit no user content, so they store no draft. */
export const ConflictDetails = z.strictObject({
  currentRevision: z.number().int().min(0),
  draftId: Uuid.optional(),
  reason: z.enum(['stale', 'trashed']),
});
export type ConflictDetailsType = z.infer<typeof ConflictDetails>;

export const LeaseRequiredDetails = z.strictObject({ draftId: Uuid.optional() });

export const LeaseAcquireRequest = z.strictObject({ noteId: Uuid, viewId: Uuid });
export const LeaseAcquireResponse = z.discriminatedUnion('granted', [
  z.strictObject({ granted: z.literal(true), leaseToken: Uuid }),
  z.strictObject({ granted: z.literal(false), holderViewId: Uuid }),
]);
export const LeaseReleaseRequest = z.strictObject({ noteId: Uuid, viewId: Uuid, leaseToken: Uuid });
export const LeaseReleaseResponse = z.strictObject({ released: z.boolean() });
export const LeaseTakeRequest = z.strictObject({ noteId: Uuid, viewId: Uuid });
export const LeaseTakeResponse = z.strictObject({ leaseToken: Uuid });

export const NoteRevisionEvent = z.strictObject({
  noteId: Uuid,
  revision: z.number().int().min(0),
  sourceViewId: Uuid,
});
export type NoteRevisionEventType = z.infer<typeof NoteRevisionEvent>;

export const NoteLeaseEvent = z.strictObject({ noteId: Uuid, holderViewId: Uuid.nullable() });
export type NoteLeaseEventType = z.infer<typeof NoteLeaseEvent>;

export const LeaseReleaseRequestEvent = z.strictObject({ noteId: Uuid });
export type LeaseReleaseRequestEventType = z.infer<typeof LeaseReleaseRequestEvent>;

// Phase 02: opening a note ----------------------------------------------------
export const NoteOpenRequest = z.strictObject({ noteId: Uuid });
export const NoteOpenResponse = z.strictObject({
  note: NoteSummary,
  format: z.enum(['rich', 'plain']),
  content: z.union([RichDoc, z.string()]),
  revision: z.number().int().min(0),
});
export type NoteOpenResponseType = z.infer<typeof NoteOpenResponse>;
export const NoteNotFoundDetails = z.strictObject({ trashed: z.literal(true), trashBatchId: Uuid.nullable() });
export type NoteNotFoundDetailsType = z.infer<typeof NoteNotFoundDetails>;

// Phase 03: content operations, versions and drafts ---------------------------------
const NoteFormat = z.enum(['rich', 'plain']);

/** Fields every content-changing operation carries: the lease and the revision it is based on. */
export const ContentOpBase = z.strictObject({
  noteId: Uuid,
  viewId: Uuid,
  leaseToken: Uuid,
  baseRevision: z.number().int().min(0),
  requestId: Uuid,
});
export type ContentOpBaseType = z.infer<typeof ContentOpBase>;

export const NoteConvertRequest = ContentOpBase
  .extend({ targetFormat: NoteFormat, confirmLossy: z.literal(true).optional() })
  .superRefine((req, ctx) => {
    if (req.targetFormat === 'plain' && req.confirmLossy !== true) {
      ctx.addIssue({ code: 'custom', path: ['confirmLossy'], message: 'Converting to plain text removes formatting and must be confirmed' });
    }
  });
export type NoteConvertRequestType = z.infer<typeof NoteConvertRequest>;

export const NoteContentResponse = z.strictObject({
  noteId: Uuid,
  revision: z.number().int().min(0),
  format: NoteFormat,
  content: z.union([RichDoc, z.string()]),
  versionId: Uuid.nullable(),
  updatedAt: z.number().int(),
});
export type NoteContentResponseType = z.infer<typeof NoteContentResponse>;

export const VersionReason = z.enum(['auto', 'conversion', 'conflict', 'restore', 'import']);
export type VersionReasonType = z.infer<typeof VersionReason>;

export const VersionSummary = z.strictObject({
  id: Uuid,
  revision: z.number().int().min(0),
  format: NoteFormat,
  reason: VersionReason,
  createdAt: z.number().int(),
  preview: z.string().max(200),
  attachmentCount: z.number().int().min(0),
});
export type VersionSummaryType = z.infer<typeof VersionSummary>;

export const VersionsListRequest = z.strictObject({ noteId: Uuid, limit: z.number().int().min(1).max(200).optional() });
export const VersionsListResponse = z.strictObject({ versions: z.array(VersionSummary) });
export type VersionsListResponseType = z.infer<typeof VersionsListResponse>;
export const VersionsRestoreRequest = ContentOpBase.extend({ versionId: Uuid });
export type VersionsRestoreRequestType = z.infer<typeof VersionsRestoreRequest>;

export const MAX_DRAFT_PREVIEW_CHARS = 20_000;
export const MAX_LISTED_DRAFTS = 20;

export const DraftSummary = z.strictObject({
  id: Uuid,
  reason: z.enum(['conflict', 'lease_lost']),
  baseRevision: z.number().int().min(0),
  format: NoteFormat,
  title: z.string().nullable(),
  createdAt: z.number().int(),
  plainText: z.string().max(MAX_DRAFT_PREVIEW_CHARS),
  truncated: z.boolean(),
});
export type DraftSummaryType = z.infer<typeof DraftSummary>;

export const DraftsListRequest = z.strictObject({ noteId: Uuid });
export const DraftsListResponse = z.strictObject({ drafts: z.array(DraftSummary).max(MAX_LISTED_DRAFTS) });
export type DraftsListResponseType = z.infer<typeof DraftsListResponse>;
export const DraftsResolveRequest = z.discriminatedUnion('action', [
  ContentOpBase.extend({ action: z.literal('restore'), draftId: Uuid }),
  z.strictObject({ action: z.literal('dismiss'), noteId: Uuid, draftId: Uuid }),
]);
export type DraftsResolveRequestType = z.infer<typeof DraftsResolveRequest>;
export const DraftsResolveResponse = z.strictObject({ resolved: z.literal(true), content: NoteContentResponse.nullable() });
export type DraftsResolveResponseType = z.infer<typeof DraftsResolveResponse>;
