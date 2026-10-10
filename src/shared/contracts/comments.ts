import { z } from 'zod';
import { CommentAnchor } from '../comments/anchors';
import { Uuid } from './ids';

/** Longest comment, quoted text, and the most threads per item and comments per thread (F8, D-165). */
export const MAX_COMMENT_CHARS = 10_000;
export const MAX_COMMENT_QUOTE = 500;
export const MAX_THREADS_PER_ITEM = 1_000;
export const MAX_COMMENTS_PER_THREAD = 200;

export const COMMENT_MESSAGES = {
  empty: 'Write a comment first',
  tooLong: `A comment can have at most ${MAX_COMMENT_CHARS.toLocaleString('en')} characters`,
  missing: 'This comment no longer exists',
  itemMissing: 'This item is in Trash or no longer exists',
  wrongAnchor: 'A comment cannot be anchored there',
  quoteNeeded: 'Select the text to comment on',
  tooManyThreads: `An item can have at most ${MAX_THREADS_PER_ITEM.toLocaleString('en')} comment threads`,
  tooManyReplies: `A thread can have at most ${MAX_COMMENTS_PER_THREAD} comments`,
  firstComment: 'Delete the thread to remove its first comment',
  plainNote: 'Comments need a rich-text note',
  notReady: 'Wait until the document is shown',
  selectCell: 'Select a cell to comment on',
  htmlSource: 'Show the Source and select the text to comment on',
} as const;

export const CommentTarget = z.strictObject({ kind: z.enum(['note', 'document']), id: Uuid });
export type CommentTargetType = z.infer<typeof CommentTarget>;

/** A comment's text: trimmed at the ends, never empty. */
const Body = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, COMMENT_MESSAGES.empty).max(MAX_COMMENT_CHARS, COMMENT_MESSAGES.tooLong));

export const CommentDto = z.strictObject({
  id: Uuid,
  body: z.string().max(MAX_COMMENT_CHARS),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type CommentDtoType = z.infer<typeof CommentDto>;

export const CommentThreadDto = z.strictObject({
  id: Uuid,
  target: CommentTarget,
  anchor: CommentAnchor,
  /** The text the thread was made on (kept up to date for notes); '' for anchors without text (a PDF area, a cell). */
  quote: z.string().max(MAX_COMMENT_QUOTE),
  resolvedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  /** Oldest first; the first one opened the thread. */
  comments: z.array(CommentDto).min(1).max(MAX_COMMENTS_PER_THREAD),
});
export type CommentThreadDtoType = z.infer<typeof CommentThreadDto>;

export const CommentListRequest = z.strictObject({ target: CommentTarget });
export const CommentListResponse = z.strictObject({ threads: z.array(CommentThreadDto).max(MAX_THREADS_PER_ITEM) });

export const CommentCreateRequest = z.strictObject({
  target: CommentTarget,
  anchor: CommentAnchor,
  quote: z.string().max(MAX_COMMENT_QUOTE),
  body: Body,
});
export const CommentReplyRequest = z.strictObject({ threadId: Uuid, body: Body });
export const CommentEditRequest = z.strictObject({ commentId: Uuid, body: Body });
export const CommentIdRequest = z.strictObject({ commentId: Uuid });
export const CommentThreadIdRequest = z.strictObject({ threadId: Uuid });
export const CommentResolveRequest = z.strictObject({ threadId: Uuid, resolved: z.boolean() });
export const CommentThreadResponse = z.strictObject({ thread: CommentThreadDto });
export const CommentDeletedResponse = z.strictObject({ deleted: z.literal(true) });
