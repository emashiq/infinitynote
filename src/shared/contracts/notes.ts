import { z } from 'zod';
import { NoteSummary } from './hierarchy';
import { Uuid } from './ids';

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

export const NoteSaveAck = z.strictObject({
  noteId: Uuid,
  revision: z.number().int().min(0),
  requestId: Uuid,
  updatedAt: z.number().int(),
});
export type NoteSaveAckType = z.infer<typeof NoteSaveAck>;

export const ConflictDetails = z.strictObject({
  currentRevision: z.number().int().min(0),
  draftId: Uuid,
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
