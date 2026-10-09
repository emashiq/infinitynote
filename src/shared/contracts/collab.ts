import { z } from 'zod';
import { MAX_CONTENT_BYTES, RichDoc } from './notes';
import { Uuid } from './ids';

/**
 * Live sync of one note between its views (D-103): main holds the authoritative document and orders the editing
 * steps of every view (ProseMirror collab with a central authority); views rebase their unconfirmed steps.
 */

/** Steps per push. A view sends what it has not had confirmed yet, normally a few. */
export const MAX_PUSH_STEPS = 5000;
/** A push may carry a large paste (pastes over 8 MB are refused before they reach the document, D-060). */
export const MAX_PUSH_BYTES = 3 * MAX_CONTENT_BYTES;

/** A ProseMirror step as JSON; main rebuilds it against the note's schema, which rejects anything else. */
const StepJson = z.looseObject({ stepType: z.string().min(1).max(32) });
const Steps = z.array(StepJson).max(MAX_PUSH_STEPS);
const Version = z.number().int().min(0);

export const CollabJoinRequest = z.strictObject({ noteId: Uuid, viewId: Uuid });
/** The authoritative document (both formats are editor documents) at a version of the session `epoch`. */
export const CollabSnapshot = z.strictObject({
  epoch: Uuid,
  version: Version,
  format: z.enum(['rich', 'plain']),
  doc: RichDoc,
  /** The stored revision the document was loaded from or last saved as. */
  revision: z.number().int().min(0),
});
export type CollabSnapshotType = z.infer<typeof CollabSnapshot>;

export const CollabPushRequest = z.strictObject({ noteId: Uuid, viewId: Uuid, epoch: Uuid, version: Version, steps: Steps.min(1) });
export type CollabPushRequestType = z.infer<typeof CollabPushRequest>;
/** `behind`: other steps came first, the view rebases and pushes again; `reset`: the session started over. */
export const CollabPushResponse = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('accepted'), version: Version }),
  z.strictObject({ status: z.literal('behind'), version: Version }),
  z.strictObject({ status: z.literal('reset') }),
]);
export type CollabPushResponseType = z.infer<typeof CollabPushResponse>;

export const CollabPullRequest = z.strictObject({ noteId: Uuid, viewId: Uuid, epoch: Uuid, version: Version });
export const CollabPullResponse = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('steps'), version: Version, steps: Steps, clientIDs: z.array(Uuid).max(MAX_PUSH_STEPS) }),
  z.strictObject({ status: z.literal('reset') }),
]);
export type CollabPullResponseType = z.infer<typeof CollabPullResponse>;

/** Saves the authoritative document now; `force` also saves block IDs main gave the document when it opened. */
export const CollabFlushRequest = z.strictObject({ noteId: Uuid, viewId: Uuid, force: z.boolean().optional() });
export const CollabFlushResponse = z.strictObject({ revision: z.number().int().min(0) });
export type CollabFlushResponseType = z.infer<typeof CollabFlushResponse>;

export const CollabLeaveRequest = z.strictObject({ noteId: Uuid, viewId: Uuid });
export const CollabLeaveResponse = z.strictObject({ left: z.boolean() });

/** Confirmed steps from `version` on, sent to every view of the note (the sender's own steps confirm them). */
export const CollabStepsEvent = z.strictObject({
  noteId: Uuid,
  epoch: Uuid,
  version: Version,
  steps: Steps,
  clientIDs: z.array(Uuid).max(MAX_PUSH_STEPS),
});
export type CollabStepsEventType = z.infer<typeof CollabStepsEvent>;

/**
 * The document was replaced from outside the session (a conversion, a restore, another writer): views join again. A
 * `conflict` names the recovered draft that keeps edits main could not save on top of the replacement.
 */
export const CollabResetEvent = z.strictObject({
  noteId: Uuid,
  conflict: z.strictObject({ draftId: Uuid, reason: z.enum(['stale', 'trashed']) }).nullable(),
});
export type CollabResetEventType = z.infer<typeof CollabResetEvent>;

/** Where saving the authoritative document stands: saved up to `version`, retrying, or failed with `message`. */
export const CollabStatusEvent = z.strictObject({
  noteId: Uuid,
  epoch: Uuid,
  savedVersion: Version,
  revision: z.number().int().min(0),
  state: z.enum(['saved', 'retrying', 'error']),
  message: z.string().max(500).nullable(),
});
export type CollabStatusEventType = z.infer<typeof CollabStatusEvent>;
