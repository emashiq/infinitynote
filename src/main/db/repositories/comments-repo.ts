import type { Db } from '../driver';

export interface ThreadRow {
  id: string;
  target_kind: 'note' | 'document';
  target_id: string;
  anchor_json: string;
  quote: string | null;
  sealed_quote: Buffer | null;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CommentRow {
  id: string;
  thread_id: string;
  body: string | null;
  sealed_body: Buffer | null;
  created_at: number;
  updated_at: number;
}

/** A thread's quote or a comment's body as stored: in the clear, or sealed with its note's data key (D-111). */
export type StoredText = { text: string; sealed: null } | { text: null; sealed: Buffer };

const THREAD_COLS = 'id, target_kind, target_id, anchor_json, quote, sealed_quote, resolved_at, created_at, updated_at';
const COMMENT_COLS = 'id, thread_id, body, sealed_body, created_at, updated_at';

/** Comment threads and their comments (F8, D-165). */
export class CommentsRepo {
  constructor(private readonly db: Db) {}

  threadsOf(kind: 'note' | 'document', targetId: string): ThreadRow[] {
    return this.db
      .prepare<[string, string], ThreadRow>(`SELECT ${THREAD_COLS} FROM comment_threads WHERE target_kind = ? AND target_id = ? ORDER BY created_at, id`)
      .all(kind, targetId);
  }

  commentsOf(threadIds: readonly string[]): CommentRow[] {
    if (threadIds.length === 0) return [];
    return this.db
      .prepare<[string], CommentRow>(
        `SELECT ${COMMENT_COLS} FROM comments WHERE thread_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, key`,
      )
      .all(JSON.stringify(threadIds));
  }

  thread(id: string): ThreadRow | undefined {
    return this.db.prepare<[string], ThreadRow>(`SELECT ${THREAD_COLS} FROM comment_threads WHERE id = ?`).get(id);
  }

  comment(id: string): CommentRow | undefined {
    return this.db.prepare<[string], CommentRow>(`SELECT ${COMMENT_COLS} FROM comments WHERE id = ?`).get(id);
  }

  /** The thread's first comment (the one that opened it). */
  firstCommentId(threadId: string): string | undefined {
    return this.db.prepare<[string], { id: string }>('SELECT id FROM comments WHERE thread_id = ? ORDER BY created_at, key LIMIT 1').get(threadId)?.id;
  }

  countThreads(kind: 'note' | 'document', targetId: string): number {
    return this.db.prepare<[string, string], { n: number }>('SELECT count(*) AS n FROM comment_threads WHERE target_kind = ? AND target_id = ?').get(kind, targetId)!.n;
  }

  countComments(threadId: string): number {
    return this.db.prepare<[string], { n: number }>('SELECT count(*) AS n FROM comments WHERE thread_id = ?').get(threadId)!.n;
  }

  insertThread(t: { id: string; kind: 'note' | 'document'; targetId: string; anchorJson: string; quote: StoredText; resolvedAt?: number | null; now: number }): void {
    this.db
      .prepare(
        `INSERT INTO comment_threads (id, target_kind, target_id, anchor_json, quote, sealed_quote, resolved_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(t.id, t.kind, t.targetId, t.anchorJson, t.quote.text, t.quote.sealed, t.resolvedAt ?? null, t.now, t.now);
  }

  insertComment(c: { id: string; threadId: string; body: StoredText; createdAt: number; updatedAt: number }): void {
    this.db
      .prepare('INSERT INTO comments (id, thread_id, body, sealed_body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c.id, c.threadId, c.body.text, c.body.sealed, c.createdAt, c.updatedAt);
  }

  setBody(id: string, body: StoredText, now: number | null): void {
    this.db
      .prepare<[string | null, Buffer | null, number | null, string]>('UPDATE comments SET body = ?, sealed_body = ?, updated_at = coalesce(?, updated_at) WHERE id = ?')
      .run(body.text, body.sealed, now, id);
  }

  setQuote(threadId: string, quote: StoredText): void {
    this.db.prepare<[string | null, Buffer | null, string]>('UPDATE comment_threads SET quote = ?, sealed_quote = ? WHERE id = ?').run(quote.text, quote.sealed, threadId);
  }

  setAnchor(threadId: string, anchorJson: string): void {
    this.db.prepare<[string, string]>('UPDATE comment_threads SET anchor_json = ? WHERE id = ?').run(anchorJson, threadId);
  }

  setResolved(threadId: string, resolvedAt: number | null, now: number): void {
    this.db.prepare<[number | null, number, string]>('UPDATE comment_threads SET resolved_at = ?, updated_at = ? WHERE id = ?').run(resolvedAt, now, threadId);
  }

  touchThread(threadId: string, now: number): void {
    this.db.prepare<[number, string]>('UPDATE comment_threads SET updated_at = ? WHERE id = ?').run(now, threadId);
  }

  deleteThread(id: string): void {
    this.db.prepare<[string]>('DELETE FROM comment_threads WHERE id = ?').run(id);
  }

  deleteComment(id: string): void {
    this.db.prepare<[string]>('DELETE FROM comments WHERE id = ?').run(id);
  }

  /** Every thread of the exportable items: live notes that are not locked and live documents (D-111). */
  exportableThreads(): ThreadRow[] {
    return this.db
      .prepare<[], ThreadRow>(
        `SELECT ${prefixed('t')} FROM comment_threads t
          WHERE (t.target_kind = 'note' AND EXISTS (SELECT 1 FROM notes n WHERE n.id = t.target_id AND n.deleted_at IS NULL AND n.locked = 0))
             OR (t.target_kind = 'document' AND EXISTS (SELECT 1 FROM documents d WHERE d.id = t.target_id AND d.deleted_at IS NULL))
          ORDER BY t.created_at, t.id`,
      )
      .all();
  }
}

function prefixed(alias: string): string {
  return THREAD_COLS.split(', ')
    .map((c) => `${alias}.${c}`)
    .join(', ');
}
