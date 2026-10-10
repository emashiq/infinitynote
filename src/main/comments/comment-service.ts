import { anchorFits, anchorNeedsQuote, CommentAnchor, type CommentAnchorType } from '../../shared/comments/anchors';
import {
  COMMENT_MESSAGES,
  MAX_COMMENT_QUOTE,
  MAX_COMMENTS_PER_THREAD,
  MAX_THREADS_PER_ITEM,
  type CommentTargetType,
  type CommentThreadDtoType,
} from '../../shared/contracts/comments';
import type { Db } from '../db/driver';
import { CommentsRepo, type CommentRow, type ThreadRow } from '../db/repositories/comments-repo';
import { DocumentsRepo } from '../db/repositories/documents-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import type { NoteVault } from '../locks/note-vault';
import { AppError } from '../services/app-error';
import type { Clock } from '../services/clock';
import type { IdGenerator } from '../services/ids';
import type { Logger } from '../services/logger';
import { runTx } from '../services/transaction';
import { PLAIN_COMMENTS, sealedComments, type CommentCipher } from './comment-cipher';

export interface CommentServiceDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  vault: NoteVault;
}

const missing = (): AppError => new AppError('NOT_FOUND', COMMENT_MESSAGES.missing);

/** A stored anchor; one that no longer parses (it never should) reads as the start of a note. */
function parseAnchor(json: string): CommentAnchorType {
  const parsed = CommentAnchor.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : { type: 'text', blockId: null };
}

/**
 * Comment threads on notes and documents (F8, D-165), single user. Only live items take comments; a locked note's
 * comments are read and written only while it is unlocked, sealed with its data key (D-111). Every change runs in one
 * transaction and returns the thread as it now is.
 */
export class CommentService {
  private readonly repo: CommentsRepo;
  private readonly notes: NotesRepo;
  private readonly documents: DocumentsRepo;

  constructor(private readonly deps: CommentServiceDeps) {
    this.repo = new CommentsRepo(deps.db);
    this.notes = new NotesRepo(deps.db);
    this.documents = new DocumentsRepo(deps.db);
  }

  list(target: CommentTargetType): { threads: CommentThreadDtoType[] } {
    const cipher = this.liveTarget(target).cipher;
    const threads = this.repo.threadsOf(target.kind, target.id);
    const comments = groupByThread(this.repo.commentsOf(threads.map((t) => t.id)));
    return { threads: threads.map((t) => this.toDto(t, comments.get(t.id) ?? [], cipher)) };
  }

  create(req: { target: CommentTargetType; anchor: CommentAnchorType; quote: string; body: string }): { thread: CommentThreadDtoType } {
    return this.tx(() => {
      const { cipher, fits } = this.liveTarget(req.target);
      if (!fits(req.anchor)) throw new AppError('VALIDATION_FAILED', COMMENT_MESSAGES.wrongAnchor);
      // An HTML quote is found again in the page source as it is, so only its ends are trimmed.
      const quote = req.quote.trim().slice(0, MAX_COMMENT_QUOTE);
      if (anchorNeedsQuote(req.anchor) && quote === '') throw new AppError('VALIDATION_FAILED', COMMENT_MESSAGES.quoteNeeded);
      if (this.repo.countThreads(req.target.kind, req.target.id) >= MAX_THREADS_PER_ITEM) throw new AppError('LIMIT_EXCEEDED', COMMENT_MESSAGES.tooManyThreads);
      const now = this.deps.clock.now();
      const threadId = this.deps.ids.uuid();
      const commentId = this.deps.ids.uuid();
      this.repo.insertThread({ id: threadId, kind: req.target.kind, targetId: req.target.id, anchorJson: JSON.stringify(req.anchor), quote: cipher.store('quote', threadId, quote), now });
      this.repo.insertComment({ id: commentId, threadId, body: cipher.store('comment', commentId, req.body), createdAt: now, updatedAt: now });
      this.deps.logger.info(`comments: thread created id=${threadId} target=${req.target.kind}`);
      return this.threadDto(threadId, cipher);
    });
  }

  reply(req: { threadId: string; body: string }): { thread: CommentThreadDtoType } {
    return this.tx(() => {
      const { thread, cipher } = this.liveThread(req.threadId);
      if (this.repo.countComments(thread.id) >= MAX_COMMENTS_PER_THREAD) throw new AppError('LIMIT_EXCEEDED', COMMENT_MESSAGES.tooManyReplies);
      const now = this.deps.clock.now();
      const commentId = this.deps.ids.uuid();
      this.repo.insertComment({ id: commentId, threadId: thread.id, body: cipher.store('comment', commentId, req.body), createdAt: now, updatedAt: now });
      this.repo.touchThread(thread.id, now);
      return this.threadDto(thread.id, cipher);
    });
  }

  edit(req: { commentId: string; body: string }): { thread: CommentThreadDtoType } {
    return this.tx(() => {
      const comment = this.repo.comment(req.commentId);
      if (!comment) throw missing();
      const { thread, cipher } = this.liveThread(comment.thread_id);
      const now = this.deps.clock.now();
      this.repo.setBody(comment.id, cipher.store('comment', comment.id, req.body), now);
      this.repo.touchThread(thread.id, now);
      return this.threadDto(thread.id, cipher);
    });
  }

  /** Deletes a reply; the first comment goes only with its thread. */
  deleteComment(commentId: string): { thread: CommentThreadDtoType } {
    return this.tx(() => {
      const comment = this.repo.comment(commentId);
      if (!comment) throw missing();
      const { thread, cipher } = this.liveThread(comment.thread_id);
      if (this.repo.firstCommentId(thread.id) === comment.id) throw new AppError('VALIDATION_FAILED', COMMENT_MESSAGES.firstComment);
      this.repo.deleteComment(comment.id);
      this.repo.touchThread(thread.id, this.deps.clock.now());
      return this.threadDto(thread.id, cipher);
    });
  }

  deleteThread(threadId: string): { deleted: true } {
    return this.tx(() => {
      this.liveThread(threadId);
      this.repo.deleteThread(threadId);
      this.deps.logger.info(`comments: thread deleted id=${threadId}`);
      return { deleted: true as const };
    });
  }

  resolve(req: { threadId: string; resolved: boolean }): { thread: CommentThreadDtoType } {
    return this.tx(() => {
      const { thread, cipher } = this.liveThread(req.threadId);
      const now = this.deps.clock.now();
      this.repo.setResolved(thread.id, req.resolved ? now : null, now);
      return this.threadDto(thread.id, cipher);
    });
  }

  // Targets -----------------------------------------------------------------------------------------------------------
  /**
   * A live item that takes comments, with how its comment text is stored and which anchors suit it. A trashed or
   * missing item is NOT_FOUND; a locked note whose key is not in memory is FORBIDDEN `{locked: true}` (the vault's).
   */
  private liveTarget(target: CommentTargetType): { cipher: CommentCipher; fits: (anchor: CommentAnchorType) => boolean } {
    if (target.kind === 'note') {
      const note = this.notes.getContentRow(target.id);
      if (!note || note.deleted_at !== null) throw new AppError('NOT_FOUND', COMMENT_MESSAGES.itemMissing);
      const cipher = note.locked === 1 ? sealedComments(this.deps.vault.keyOf(note.id), note.id) : PLAIN_COMMENTS;
      return {
        cipher,
        fits: (anchor) => {
          if (note.format !== 'rich') throw new AppError('VALIDATION_FAILED', COMMENT_MESSAGES.plainNote);
          return anchorFits(anchor, { kind: 'note' });
        },
      };
    }
    const document = this.documents.get(target.id);
    if (!document || document.deleted_at !== null) throw new AppError('NOT_FOUND', COMMENT_MESSAGES.itemMissing);
    return { cipher: PLAIN_COMMENTS, fits: (anchor) => anchorFits(anchor, { kind: 'document', documentKind: document.kind }) };
  }

  private liveThread(threadId: string): { thread: ThreadRow; cipher: CommentCipher } {
    const thread = this.repo.thread(threadId);
    if (!thread) throw missing();
    return { thread, cipher: this.liveTarget({ kind: thread.target_kind, id: thread.target_id }).cipher };
  }

  private threadDto(threadId: string, cipher: CommentCipher): { thread: CommentThreadDtoType } {
    const thread = this.repo.thread(threadId)!;
    return { thread: this.toDto(thread, this.repo.commentsOf([threadId]), cipher) };
  }

  private toDto(t: ThreadRow, comments: readonly CommentRow[], cipher: CommentCipher): CommentThreadDtoType {
    return {
      id: t.id,
      target: { kind: t.target_kind, id: t.target_id },
      anchor: parseAnchor(t.anchor_json),
      quote: cipher.read('quote', t.id, { text: t.quote, sealed: t.sealed_quote }),
      resolvedAt: t.resolved_at,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      comments: comments.map((c) => ({ id: c.id, body: cipher.read('comment', c.id, { text: c.body, sealed: c.sealed_body }), createdAt: c.created_at, updatedAt: c.updated_at })),
    };
  }

  private tx<T>(fn: () => T): T {
    return runTx(this.deps.db, this.deps.logger, fn);
  }
}

function groupByThread(comments: readonly CommentRow[]): Map<string, CommentRow[]> {
  const out = new Map<string, CommentRow[]>();
  for (const c of comments) {
    const list = out.get(c.thread_id);
    if (list) list.push(c);
    else out.set(c.thread_id, [c]);
  }
  return out;
}
