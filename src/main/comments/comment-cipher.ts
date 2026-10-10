import type { Db } from '../db/driver';
import { CommentsRepo, type StoredText } from '../db/repositories/comments-repo';
import { openText, sealText } from '../locks/note-crypto';

/**
 * How comment text is stored (D-165): in the clear, or for a locked note sealed with the note's data key like its
 * content (D-111). The sealed value is bound to the note and to the comment or thread it belongs to, so it never opens
 * as another comment's text.
 */
export interface CommentCipher {
  /** A thread's quote or a comment's body as it is stored. */
  store(kind: 'quote' | 'comment', id: string, text: string): StoredText;
  /** The text of a stored quote or body. */
  read(kind: 'quote' | 'comment', id: string, stored: { text: string | null; sealed: Buffer | null }): string;
}

export const PLAIN_COMMENTS: CommentCipher = {
  store: (_kind, _id, text) => ({ text, sealed: null }),
  read: (_kind, _id, stored) => stored.text ?? '',
};

/** The cipher of a locked note's comments; the key stays the caller's (the vault's, or the lock change's). */
export function sealedComments(key: Buffer, noteId: string): CommentCipher {
  const bound = (id: string) => `${noteId}/${id}`;
  return {
    store: (kind, id, text) => ({ text: null, sealed: sealText(key, kind, bound(id), text) }),
    read: (kind, id, stored) => (stored.sealed ? openText(key, kind, bound(id), stored.sealed) : (stored.text ?? '')),
  };
}

/** Rewrites every quote and body of a note's comments from one cipher to another, in place (a lock or its removal). */
function recode(db: Db, noteId: string, from: CommentCipher, to: CommentCipher): number {
  const repo = new CommentsRepo(db);
  const threads = repo.threadsOf('note', noteId);
  for (const t of threads) repo.setQuote(t.id, to.store('quote', t.id, from.read('quote', t.id, { text: t.quote, sealed: t.sealed_quote })));
  const comments = repo.commentsOf(threads.map((t) => t.id));
  for (const c of comments) repo.setBody(c.id, to.store('comment', c.id, from.read('comment', c.id, { text: c.body, sealed: c.sealed_body })), null);
  return comments.length;
}

/** Seals a note's comments as it is locked: inside the lock transaction, before the lock row exists. */
export const sealNoteComments = (db: Db, noteId: string, key: Buffer): number => recode(db, noteId, PLAIN_COMMENTS, sealedComments(key, noteId));

/** Opens a note's comments as its lock is removed: inside that transaction, after the lock row is gone. */
export const openNoteComments = (db: Db, noteId: string, key: Buffer): number => recode(db, noteId, sealedComments(key, noteId), PLAIN_COMMENTS);
