import { AI_MESSAGES } from '../../shared/ai/limits';
import { anchorFits, anchorNeedsQuote, CommentAnchor, type CommentAnchorType } from '../../shared/comments/anchors';
import {
  COMMENT_MESSAGES,
  MAX_COMMENT_QUOTE,
  MAX_COMMENTS_PER_THREAD,
  MAX_THREADS_PER_ITEM,
  type CommentTargetType,
  type CommentThreadDtoType,
  type MessageRoleType,
  type ThreadKindType,
} from '../../shared/contracts/comments';
import { DOCUMENT_LOCK_MESSAGES, LOCK_MESSAGES } from '../../shared/contracts/locks';
import { aiMessageInfo, parseAiMeta, type StoredAiMetaType } from '../ai/ai-meta';
import type { Db } from '../db/driver';
import { CommentsRepo, type CommentRow, type ThreadRow } from '../db/repositories/comments-repo';
import { DocumentsRepo } from '../db/repositories/documents-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import type { LockVault } from '../locks/lock-vault';
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
  vault: LockVault;
  /** Whether an AI thread's engine is answering now (D-190); no thread runs when absent. */
  running?: (threadId: string) => boolean;
}

/** A message of an AI thread as the AI service reads it, with its stored meta (the session included). */
export interface AiThreadMessage {
  role: MessageRoleType;
  body: string;
  meta: StoredAiMetaType | null;
}

/** An AI thread with everything a follow-up sends again. */
export interface AiThreadHistory {
  thread: ThreadRow;
  anchor: CommentAnchorType;
  quote: string;
  messages: AiThreadMessage[];
}

const missing = (): AppError => new AppError('NOT_FOUND', COMMENT_MESSAGES.missing);

/** A stored anchor; one that no longer parses (it never should) reads as the start of a note. */
function parseAnchor(json: string): CommentAnchorType {
  const parsed = CommentAnchor.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : { type: 'text', blockId: null };
}

/**
 * Comment threads on notes and documents (F8, D-165), single user, and AI threads built on them (D-190). Only live
 * items take comments; a locked item's comments are read and written only while it is unlocked, sealed with its data
 * key (D-111, D-185). Every change runs in one transaction and returns the thread as it now is. An AI thread takes no
 * replies, edits or resolving: the AI service adds its messages.
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

  /** One thread as it is now, of either kind. */
  get(threadId: string): { thread: CommentThreadDtoType } {
    const { cipher } = this.liveThread(threadId);
    return this.threadDto(threadId, cipher);
  }

  create(req: { target: CommentTargetType; anchor: CommentAnchorType; quote: string; body: string }): { thread: CommentThreadDtoType } {
    return this.openThread('comment', req, { role: 'user', body: req.body, meta: null });
  }

  reply(req: { threadId: string; body: string }): { thread: CommentThreadDtoType } {
    return this.tx(() => {
      const { thread, cipher } = this.liveCommentThread(req.threadId);
      this.insertMessage(thread, cipher, { role: 'user', body: req.body, meta: null });
      return this.threadDto(thread.id, cipher);
    });
  }

  edit(req: { commentId: string; body: string }): { thread: CommentThreadDtoType } {
    return this.tx(() => {
      const comment = this.repo.comment(req.commentId);
      if (!comment) throw missing();
      const { thread, cipher } = this.liveCommentThread(comment.thread_id);
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
      const { thread, cipher } = this.liveCommentThread(comment.thread_id);
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
      const { thread, cipher } = this.liveCommentThread(req.threadId);
      const now = this.deps.clock.now();
      this.repo.setResolved(thread.id, req.resolved ? now : null, now);
      return this.threadDto(thread.id, cipher);
    });
  }

  // AI threads (D-190) -----------------------------------------------------------------------------------------------

  /** Opens an AI thread on an anchor with its question; the AI service has checked that the item may take one. */
  createAi(req: { target: CommentTargetType; anchor: CommentAnchorType; quote: string; body: string; meta: StoredAiMetaType }): { thread: CommentThreadDtoType } {
    return this.openThread('ai', req, { role: 'user', body: req.body, meta: req.meta });
  }

  /** Adds a question, an answer or an error to an AI thread. */
  appendAi(threadId: string, message: { role: MessageRoleType; body: string; meta: StoredAiMetaType | null }): { thread: CommentThreadDtoType } {
    return this.tx(() => {
      const { thread, cipher } = this.liveAiThread(threadId);
      this.insertMessage(thread, cipher, message);
      return this.threadDto(thread.id, cipher);
    });
  }

  /** An AI thread with its anchor, quote and messages (meta included), for a follow-up. */
  aiHistory(threadId: string): AiThreadHistory {
    const { thread, cipher } = this.liveAiThread(threadId);
    const messages = this.repo.commentsOf([thread.id]).map((c) => ({
      role: c.role,
      body: cipher.read('comment', c.id, { text: c.body, sealed: c.sealed_body }),
      meta: this.readMeta(c, cipher),
    }));
    return {
      thread,
      anchor: parseAnchor(cipher.readAnchor(thread.id, thread.anchor_json)),
      quote: cipher.read('quote', thread.id, { text: thread.quote, sealed: thread.sealed_quote }),
      messages,
    };
  }

  /** The thread's kind and item, or NOT_FOUND. */
  threadTarget(threadId: string): { kind: ThreadKindType; target: CommentTargetType } {
    const thread = this.repo.thread(threadId);
    if (!thread) throw missing();
    return { kind: thread.kind, target: { kind: thread.target_kind, id: thread.target_id } };
  }

  // Targets -----------------------------------------------------------------------------------------------------------

  private openThread(
    kind: ThreadKindType,
    req: { target: CommentTargetType; anchor: CommentAnchorType; quote: string },
    first: { role: MessageRoleType; body: string; meta: StoredAiMetaType | null },
  ): { thread: CommentThreadDtoType } {
    return this.tx(() => {
      const { cipher, fits } = this.liveTarget(req.target);
      if (!fits(req.anchor)) throw new AppError('VALIDATION_FAILED', COMMENT_MESSAGES.wrongAnchor);
      // An HTML quote is found again in the page source as it is, so only its ends are trimmed.
      const quote = req.quote.trim().slice(0, MAX_COMMENT_QUOTE);
      if (anchorNeedsQuote(req.anchor) && quote === '') throw new AppError('VALIDATION_FAILED', COMMENT_MESSAGES.quoteNeeded);
      if (this.repo.countThreads(req.target.kind, req.target.id) >= MAX_THREADS_PER_ITEM) throw new AppError('LIMIT_EXCEEDED', COMMENT_MESSAGES.tooManyThreads);
      const now = this.deps.clock.now();
      const threadId = this.deps.ids.uuid();
      this.repo.insertThread({
        id: threadId,
        threadKind: kind,
        kind: req.target.kind,
        targetId: req.target.id,
        anchorJson: cipher.storeAnchor(threadId, JSON.stringify(req.anchor)),
        quote: cipher.store('quote', threadId, quote),
        now,
      });
      const thread = this.repo.thread(threadId)!;
      this.insertMessage(thread, cipher, first);
      this.deps.logger.info(`comments: thread created id=${threadId} kind=${kind} target=${req.target.kind}`);
      return this.threadDto(threadId, cipher);
    });
  }

  private insertMessage(thread: ThreadRow, cipher: CommentCipher, message: { role: MessageRoleType; body: string; meta: StoredAiMetaType | null }): void {
    if (this.repo.countComments(thread.id) >= MAX_COMMENTS_PER_THREAD) throw new AppError('LIMIT_EXCEEDED', COMMENT_MESSAGES.tooManyReplies);
    const now = this.deps.clock.now();
    const id = this.deps.ids.uuid();
    this.repo.insertComment({
      id,
      threadId: thread.id,
      role: message.role,
      body: cipher.store('comment', id, message.body),
      meta: message.meta ? cipher.store('meta', id, JSON.stringify(message.meta)) : null,
      createdAt: now,
      updatedAt: now,
    });
    this.repo.touchThread(thread.id, now);
  }

  /**
   * A live item that takes comments, with how its comment text is stored and which anchors suit it. A trashed or
   * missing item is NOT_FOUND; a locked note whose key is not in memory is FORBIDDEN `{locked: true}` (the vault's).
   */
  private liveTarget(target: CommentTargetType): { cipher: CommentCipher; fits: (anchor: CommentAnchorType) => boolean } {
    if (target.kind === 'note') {
      const note = this.notes.getContentRow(target.id);
      if (!note || note.deleted_at !== null) throw new AppError('NOT_FOUND', COMMENT_MESSAGES.itemMissing);
      const cipher = note.locked === 1 ? this.lockedCipher('note', note.id, LOCK_MESSAGES.locked) : PLAIN_COMMENTS;
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
    const cipher = document.locked === 1 ? this.lockedCipher('document', document.id, DOCUMENT_LOCK_MESSAGES.locked) : PLAIN_COMMENTS;
    return { cipher, fits: (anchor) => anchorFits(anchor, { kind: 'document', documentKind: document.kind }) };
  }

  /** The comment cipher of a locked item: FORBIDDEN `{locked: true}` now unless it is unlocked; each value resolves the key. */
  private lockedCipher(kind: 'note' | 'document', itemId: string, message: string): CommentCipher {
    this.deps.vault.requireUnlocked(itemId, message);
    return sealedComments(this.deps.vault.keyAccess(itemId, message), { kind, id: itemId });
  }

  private liveThread(threadId: string): { thread: ThreadRow; cipher: CommentCipher } {
    const thread = this.repo.thread(threadId);
    if (!thread) throw missing();
    return { thread, cipher: this.liveTarget({ kind: thread.target_kind, id: thread.target_id }).cipher };
  }

  /** A comment thread: AI threads take no replies, edits or resolving. */
  private liveCommentThread(threadId: string): { thread: ThreadRow; cipher: CommentCipher } {
    const live = this.liveThread(threadId);
    if (live.thread.kind === 'ai') throw new AppError('VALIDATION_FAILED', AI_MESSAGES.aiThread);
    return live;
  }

  private liveAiThread(threadId: string): { thread: ThreadRow; cipher: CommentCipher } {
    const live = this.liveThread(threadId);
    if (live.thread.kind !== 'ai') throw new AppError('VALIDATION_FAILED', AI_MESSAGES.notAiThread);
    return live;
  }

  private threadDto(threadId: string, cipher: CommentCipher): { thread: CommentThreadDtoType } {
    const thread = this.repo.thread(threadId)!;
    return { thread: this.toDto(thread, this.repo.commentsOf([threadId]), cipher) };
  }

  private readMeta(c: CommentRow, cipher: CommentCipher): StoredAiMetaType | null {
    if (c.meta === null && c.sealed_meta === null) return null;
    return parseAiMeta(cipher.read('meta', c.id, { text: c.meta, sealed: c.sealed_meta }));
  }

  private toDto(t: ThreadRow, comments: readonly CommentRow[], cipher: CommentCipher): CommentThreadDtoType {
    return {
      id: t.id,
      kind: t.kind,
      target: { kind: t.target_kind, id: t.target_id },
      anchor: parseAnchor(cipher.readAnchor(t.id, t.anchor_json)),
      quote: cipher.read('quote', t.id, { text: t.quote, sealed: t.sealed_quote }),
      resolvedAt: t.resolved_at,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      running: t.kind === 'ai' && (this.deps.running?.(t.id) ?? false),
      comments: comments.map((c) => {
        const meta = this.readMeta(c, cipher);
        return {
          id: c.id,
          role: c.role,
          body: cipher.read('comment', c.id, { text: c.body, sealed: c.sealed_body }),
          ai: meta ? aiMessageInfo(meta) : null,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        };
      }),
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
