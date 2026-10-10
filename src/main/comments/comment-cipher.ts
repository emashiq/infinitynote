import type { Db } from '../db/driver';
import { CommentsRepo, type StoredText } from '../db/repositories/comments-repo';
import { heldKey, type KeyAccess } from '../locks/lock-vault';
import { openText, sealText } from '../locks/note-crypto';

/**
 * How comment text is stored (D-165): in the clear, or for a locked note or document sealed with its data key like its
 * content (D-111, D-185). The sealed value is bound to the item and to the comment or thread it belongs to, so it never
 * opens as another comment's text. A locked document's thread anchors are sealed too, since they can name a sheet; a
 * note's anchor is only the ID of a block.
 */
export interface CommentCipher {
  /** A thread's quote or a comment's body as it is stored. */
  store(kind: 'quote' | 'comment', id: string, text: string): StoredText;
  /** The text of a stored quote or body. */
  read(kind: 'quote' | 'comment', id: string, stored: { text: string | null; sealed: Buffer | null }): string;
  /** A thread's anchor (JSON) as it is stored in `anchor_json`. */
  storeAnchor(threadId: string, json: string): string;
  /** The anchor JSON of a stored `anchor_json`. */
  readAnchor(threadId: string, stored: string): string;
}

/** The type of a stored anchor that is sealed (the migration 015 triggers check it). */
const SEALED_ANCHOR = 'sealed';

export const PLAIN_COMMENTS: CommentCipher = {
  store: (_kind, _id, text) => ({ text, sealed: null }),
  read: (_kind, _id, stored) => stored.text ?? '',
  storeAnchor: (_threadId, json) => json,
  readAnchor: (_threadId, stored) => stored,
};

/**
 * The cipher of a locked note's or document's comments. Each value resolves the key when it is sealed or opened (the
 * vault's, or a key a lock change holds), so a cipher kept across an await never uses a key that was dropped.
 */
export function sealedComments(key: KeyAccess, item: CommentItem): CommentCipher {
  const bound = (id: string) => `${item.id}/${id}`;
  const sealsAnchors = item.kind === 'document';
  return {
    store: (kind, id, text) => ({ text: null, sealed: key((k) => sealText(k, kind, bound(id), text)) }),
    read: (kind, id, stored) => (stored.sealed ? key((k) => openText(k, kind, bound(id), stored.sealed!)) : (stored.text ?? '')),
    storeAnchor: (threadId, json) =>
      sealsAnchors ? JSON.stringify({ type: SEALED_ANCHOR, data: key((k) => sealText(k, 'anchor', bound(threadId), json)).toString('base64') }) : json,
    readAnchor: (threadId, stored) => {
      const parsed = JSON.parse(stored) as { type?: unknown; data?: unknown };
      if (parsed.type !== SEALED_ANCHOR || typeof parsed.data !== 'string') return stored;
      const data = Buffer.from(parsed.data, 'base64');
      return key((k) => openText(k, 'anchor', bound(threadId), data));
    },
  };
}

/** A note or document whose comments are sealed or opened. */
export interface CommentItem {
  kind: 'note' | 'document';
  id: string;
}

/** Rewrites every anchor, quote and body of an item's comments from one cipher to another, in place (a lock or its removal). */
function recode(db: Db, item: CommentItem, from: CommentCipher, to: CommentCipher): number {
  const repo = new CommentsRepo(db);
  const threads = repo.threadsOf(item.kind, item.id);
  for (const t of threads) {
    repo.setQuote(t.id, to.store('quote', t.id, from.read('quote', t.id, { text: t.quote, sealed: t.sealed_quote })));
    repo.setAnchor(t.id, to.storeAnchor(t.id, from.readAnchor(t.id, t.anchor_json)));
  }
  const comments = repo.commentsOf(threads.map((t) => t.id));
  for (const c of comments) repo.setBody(c.id, to.store('comment', c.id, from.read('comment', c.id, { text: c.body, sealed: c.sealed_body })), null);
  return comments.length;
}

/** Seals an item's comments as it is locked: inside the lock transaction, before the lock row exists. */
export const sealComments = (db: Db, item: CommentItem, key: Buffer): number => recode(db, item, PLAIN_COMMENTS, sealedComments(heldKey(key), item));

/** Opens an item's comments as its lock is removed: inside that transaction, after the lock row is gone. */
export const openComments = (db: Db, item: CommentItem, key: Buffer): number => recode(db, item, sealedComments(heldKey(key), item), PLAIN_COMMENTS);
