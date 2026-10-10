import { MAX_COMMENT_QUOTE } from '../../shared/contracts/comments';
import { collectCommentAnchors } from '../../shared/editor/doc-schema';
import type { Db } from '../db/driver';
import { CommentsRepo } from '../db/repositories/comments-repo';
import type { CommentCipher } from './comment-cipher';

/**
 * Keeps the quotes of a note's comment threads up to date (D-165): each content write stores the text now under each
 * thread's mark and the block it starts in. A thread whose text is gone keeps its last quote, which the sidebar shows
 * under "Text removed". Runs inside the content write's transaction.
 */
export class CommentQuotes {
  private readonly repo: CommentsRepo;

  constructor(db: Db) {
    this.repo = new CommentsRepo(db);
  }

  /** `cipher` is asked for only when a quote changes (a locked note's key is needed then). */
  sync(noteId: string, format: 'rich' | 'plain', content: unknown, cipher: () => CommentCipher): void {
    if (format !== 'rich') return;
    const threads = this.repo.threadsOf('note', noteId);
    if (threads.length === 0) return;
    const anchors = collectCommentAnchors(content, MAX_COMMENT_QUOTE);
    let codec: CommentCipher | null = null;
    for (const t of threads) {
      const anchor = anchors.get(t.id);
      const quote = anchor?.quote.replace(/\s+/g, ' ').trim() ?? '';
      if (!anchor || quote === '') continue;
      codec ??= cipher();
      if (codec.read('quote', t.id, { text: t.quote, sealed: t.sealed_quote }) !== quote) this.repo.setQuote(t.id, codec.store('quote', t.id, quote));
      const anchorJson = JSON.stringify({ type: 'text', blockId: anchor.blockId });
      if (anchorJson !== t.anchor_json) this.repo.setAnchor(t.id, anchorJson);
    }
  }
}
