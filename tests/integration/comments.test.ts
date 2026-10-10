import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { COMMENT_MESSAGES } from '../../src/shared/contracts/comments';
import type { RichDocLike } from '../../src/shared/editor/doc-schema';
import { COMMENT_SNIPPET_PREFIX } from '../../src/main/services/search-service';
import { COMMON, CTX } from './document-helpers';
import { setupServices, type Services } from './hierarchy-helpers';
import { cleanProfile, restartWithRestore, tmpFile } from './portability-helpers';

const PASSWORD = 'correct horse battery';
const P1 = randomUUID();
const P2 = randomUUID();

/** A paragraph whose middle word carries a comment mark of the thread. */
const commentedPara = (id: string, threadId: string, word = 'budget') => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text: 'The ' }, { type: 'text', text: word, marks: [{ type: 'comment', attrs: { threadId } }] }, { type: 'text', text: ' is due' }],
});

function save(s: Services, noteId: string, content: RichDocLike) {
  const revision = s.row<{ revision: number }>('SELECT revision FROM notes WHERE id = ?', noteId)!.revision;
  return s.writer.save({ noteId, viewId: randomUUID(), baseRevision: revision, requestId: randomUUID(), format: 'rich', content });
}

/** A note with a thread on its text, the mark saved in the note as the editor does after creating the thread. */
async function noteWithThread(s?: Services) {
  const services = s ?? (await setupServices());
  const note = services.note(null, null, 'Plan');
  const { thread } = services.comments.create({ target: { kind: 'note', id: note.id }, anchor: { type: 'text', blockId: P1 }, quote: 'budget', body: 'Check the numbers' });
  save(services, note.id, { type: 'doc', content: [commentedPara(P1, thread.id)] });
  return { s: services, note, thread };
}

describe('migration 013 comments (D-165)', () => {
  it('creates threads and comments with their checks; a comment needs its thread and leaves with it', async () => {
    const s = await setupServices();
    const insertThread = (id: string, kind: string, anchor = '{"type":"text","blockId":null}') =>
      s.t.db
        .prepare("INSERT INTO comment_threads(id, target_kind, target_id, anchor_json, quote, created_at, updated_at) VALUES (?, ?, ?, ?, 'q', 1, 1)")
        .run(id, kind, randomUUID(), anchor);
    const id = randomUUID();
    insertThread(id, 'note');
    expect(() => insertThread(randomUUID(), 'folder')).toThrow(/CHECK/);
    expect(() => insertThread(randomUUID(), 'note', 'not json')).toThrow(/CHECK/);
    const insertComment = (threadId: string, body: string | null) =>
      s.t.db.prepare('INSERT INTO comments(id, thread_id, body, created_at, updated_at) VALUES (?, ?, ?, 1, 1)').run(randomUUID(), threadId, body);
    insertComment(id, 'hello');
    expect(() => insertComment(id, null)).toThrow(/CHECK/);
    expect(() => insertComment(randomUUID(), 'orphan')).toThrow(/FOREIGN KEY/);
    s.t.db.prepare('DELETE FROM comment_threads WHERE id = ?').run(id);
    expect(s.rows('SELECT * FROM comments')).toEqual([]);
  });
});

describe('comments on notes (F8, D-165)', () => {
  it('creates, replies, edits, resolves, reopens and deletes; the first comment goes only with its thread', async () => {
    const { s, note, thread } = await noteWithThread();
    expect(thread).toMatchObject({ target: { kind: 'note', id: note.id }, anchor: { type: 'text', blockId: P1 }, quote: 'budget', resolvedAt: null });
    expect(thread.comments.map((c) => c.body)).toEqual(['Check the numbers']);

    s.tick();
    const replied = s.comments.reply({ threadId: thread.id, body: 'Done' }).thread;
    expect(replied.comments.map((c) => c.body)).toEqual(['Check the numbers', 'Done']);
    s.tick();
    const edited = s.comments.edit({ commentId: replied.comments[1]!.id, body: 'Done, see Q3' }).thread;
    expect(edited.comments[1]).toMatchObject({ body: 'Done, see Q3' });
    expect(edited.comments[1]!.updatedAt).toBeGreaterThan(edited.comments[1]!.createdAt);

    expect(s.comments.resolve({ threadId: thread.id, resolved: true }).thread.resolvedAt).not.toBeNull();
    expect(s.comments.resolve({ threadId: thread.id, resolved: false }).thread.resolvedAt).toBeNull();

    expect(() => s.comments.deleteComment(thread.comments[0]!.id)).toThrow(COMMENT_MESSAGES.firstComment);
    expect(s.comments.deleteComment(replied.comments[1]!.id).thread.comments).toHaveLength(1);
    s.comments.deleteThread(thread.id);
    expect(s.comments.list({ kind: 'note', id: note.id }).threads).toEqual([]);
    expect(() => s.comments.reply({ threadId: thread.id, body: 'late' })).toThrow(COMMENT_MESSAGES.missing);
  });

  it('refuses anchors of another kind, empty quotes, plain-text notes and trashed items', async () => {
    const s = await setupServices();
    const note = s.note(null, null, 'Plan');
    const target = { kind: 'note' as const, id: note.id };
    expect(() => s.comments.create({ target, anchor: { type: 'slide', slide: 1, shapeId: null }, quote: 'x', body: 'b' })).toThrow(COMMENT_MESSAGES.wrongAnchor);
    expect(() => s.comments.create({ target, anchor: { type: 'text', blockId: null }, quote: '  ', body: 'b' })).toThrow(COMMENT_MESSAGES.quoteNeeded);
    s.formats.convert({ noteId: note.id, viewId: randomUUID(), baseRevision: 0, requestId: randomUUID(), targetFormat: 'plain', confirmLossy: true });
    expect(() => s.comments.create({ target, anchor: { type: 'text', blockId: null }, quote: 'x', body: 'b' })).toThrow(COMMENT_MESSAGES.plainNote);
    const other = s.note(null, null, 'Other');
    s.trash.trashNote(other.id);
    expect(() => s.comments.list({ kind: 'note', id: other.id })).toThrow(COMMENT_MESSAGES.itemMissing);
  });

  it('keeps the quote and block of each thread up to date as the note is saved; a thread whose text is gone keeps its last quote', async () => {
    const { s, note, thread } = await noteWithThread();
    const moved = randomUUID();
    save(s, note.id, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: P2 } }, commentedPara(moved, thread.id, 'revised budget')] });
    const updated = s.comments.list({ kind: 'note', id: note.id }).threads[0]!;
    expect(updated.quote).toBe('revised budget');
    expect(updated.anchor).toEqual({ type: 'text', blockId: moved });
    save(s, note.id, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: P1 }, content: [{ type: 'text', text: 'All gone' }] }] });
    expect(s.comments.list({ kind: 'note', id: note.id }).threads[0]!.quote).toBe('revised budget');
  });

  it('a pasted copy of commented text does not alias the thread: only the first run keeps the mark', async () => {
    const { s, note, thread } = await noteWithThread();
    save(s, note.id, { type: 'doc', content: [commentedPara(P1, thread.id), commentedPara(P2, thread.id, 'copy')] });
    const stored = JSON.parse(s.row<{ content_json: string }>('SELECT content_json FROM notes WHERE id = ?', note.id)!.content_json) as RichDocLike;
    expect(JSON.stringify(stored.content![1])).not.toContain('comment');
    expect(s.comments.list({ kind: 'note', id: note.id }).threads[0]!.quote).toBe('budget');
  });

  it('threads stay with a trashed note, come back with it and are deleted with its purge (search index included)', async () => {
    const { s, note, thread } = await noteWithThread();
    s.comments.reply({ threadId: thread.id, body: 'zebracrossing reply' });
    expect(s.search.query({ query: 'zebracrossing' }).results.map((r) => r.note.id)).toEqual([note.id]);
    const { trashBatchId } = s.trash.trashNote(note.id);
    expect(s.search.query({ query: 'zebracrossing' }).results).toEqual([]);
    expect(s.rows('SELECT id FROM comment_threads')).toHaveLength(1);
    s.trash.restore(trashBatchId);
    expect(s.comments.list({ kind: 'note', id: note.id }).threads[0]!.comments).toHaveLength(2);
    const again = s.trash.trashNote(note.id);
    s.trash.purge({ target: { kind: 'batch', batchId: again.trashBatchId }, confirmed: true });
    expect(s.rows('SELECT id FROM comment_threads')).toEqual([]);
    expect(s.rows('SELECT key FROM comments')).toEqual([]);
    expect(s.rows("SELECT rowid FROM comments_fts WHERE comments_fts MATCH 'zebracrossing'")).toEqual([]);
  });

  it('search finds items by their comments, with the comment as the snippet, after items found by their own text', async () => {
    const { s, note, thread } = await noteWithThread();
    s.comments.reply({ threadId: thread.id, body: 'Ask finance about quarterly forecast' });
    const own = s.note(null, null, 'Quarterly forecast');
    const hits = s.search.query({ query: 'quarterly forecast' }).results;
    expect(hits.map((r) => r.note.id)).toEqual([own.id, note.id]);
    expect(hits[1]!.snippet.map((x) => x.text).join('')).toContain(COMMENT_SNIPPET_PREFIX);
    expect(hits[1]!.snippet.filter((x) => x.hit).map((x) => x.text.toLowerCase())).toEqual(['quarterly', 'forecast']);
  });
});

describe('comments on documents (F8, D-165)', () => {
  it('a document takes the anchor of its kind only and its threads follow it to Trash and purge', async () => {
    const s = await setupServices();
    const { document } = await s.documents.createBlank('xlsx', COMMON, 'Budget');
    const target = { kind: 'document' as const, id: document.id };
    expect(() => s.comments.create({ target, anchor: { type: 'pdf', page: 1, rect: null }, quote: '', body: 'b' })).toThrow(COMMENT_MESSAGES.wrongAnchor);
    const { thread } = s.comments.create({ target, anchor: { type: 'cell', sheet: 'Sheet1', row: 1, col: 2 }, quote: '', body: 'Is this final?' });
    expect(s.comments.list(target).threads.map((t) => t.id)).toEqual([thread.id]);
    const { trashBatchId } = s.trash.trashDocument(document.id);
    s.trash.purge({ target: { kind: 'batch', batchId: trashBatchId }, confirmed: true });
    expect(s.rows('SELECT id FROM comment_threads')).toEqual([]);
  });
});

describe('comments of locked notes (D-111, D-165)', () => {
  it('locking seals every quote and body with the note key; nothing is in the clear or in the search index', async () => {
    const { s, note, thread } = await noteWithThread();
    s.comments.reply({ threadId: thread.id, body: 'secretpineapple' });
    await s.locks.lock({ noteId: note.id, password: PASSWORD, hello: false });
    expect(s.rows('SELECT quote FROM comment_threads WHERE quote IS NOT NULL')).toEqual([]);
    expect(s.rows('SELECT body FROM comments WHERE body IS NOT NULL')).toEqual([]);
    const sealed = s.rows<{ sealed_body: Buffer }>('SELECT sealed_body FROM comments');
    for (const r of sealed) expect(r.sealed_body.toString('latin1')).not.toContain('secretpineapple');
    expect(s.rows("SELECT rowid FROM comments_fts WHERE comments_fts MATCH 'secretpineapple'")).toEqual([]);
    expect(s.search.query({ query: 'secretpineapple' }).results).toEqual([]);

    // Still locked for the session: comments cannot be read or written without the key.
    s.locks.lockNow(note.id);
    expect(() => s.comments.list({ kind: 'note', id: note.id })).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    await s.locks.unlock({ noteId: note.id, password: PASSWORD });
    const listed = s.comments.list({ kind: 'note', id: note.id }).threads[0]!;
    expect(listed.quote).toBe('budget');
    expect(listed.comments.map((c) => c.body)).toEqual(['Check the numbers', 'secretpineapple']);
    s.comments.reply({ threadId: thread.id, body: 'another secret' });
    expect(s.rows('SELECT body FROM comments WHERE body IS NOT NULL')).toEqual([]);
  });

  it('the database refuses plaintext comments on a locked note', async () => {
    const { s, note, thread } = await noteWithThread();
    await s.locks.lock({ noteId: note.id, password: PASSWORD, hello: false });
    expect(() => s.t.db.prepare("INSERT INTO comments(id, thread_id, body, created_at, updated_at) VALUES (?, ?, 'clear', 1, 1)").run(randomUUID(), thread.id)).toThrow(
      /must be encrypted/,
    );
    expect(() => s.t.db.prepare("UPDATE comment_threads SET quote = 'clear', sealed_quote = NULL WHERE id = ?").run(thread.id)).toThrow(/must be encrypted/);
  });

  it('removing the lock opens the comments again; a locked note’s comments are not exported', async () => {
    const { s, note, thread } = await noteWithThread();
    await s.locks.lock({ noteId: note.id, password: PASSWORD, hello: false });
    const file = tmpFile('locked.infinityexport');
    s.pathQueue.push(file);
    await s.portability.exportPortable(CTX);
    const b = await setupServices();
    b.pathQueue.push(file);
    await b.portability.importPortable(CTX);
    expect(b.rows('SELECT id FROM comment_threads')).toEqual([]);

    await s.locks.remove({ noteId: note.id, password: PASSWORD });
    expect(s.row<{ quote: string }>('SELECT quote FROM comment_threads WHERE id = ?', thread.id)!.quote).toBe('budget');
    expect(s.search.query({ query: 'check numbers' }).results.map((r) => r.note.id)).toEqual([note.id]);
  });
});

describe('comments in backups and portable exports (D-165)', () => {
  it('an export carries threads with new IDs on import; the marks in the note follow their thread', async () => {
    const { s, thread } = await noteWithThread();
    s.comments.reply({ threadId: thread.id, body: 'Second' });
    s.comments.resolve({ threadId: thread.id, resolved: true });
    const { document } = await s.documents.createBlank('pptx', COMMON, 'Deck');
    s.comments.create({ target: { kind: 'document', id: document.id }, anchor: { type: 'slide', slide: 2, shapeId: null }, quote: '', body: 'Slide note' });

    const file = tmpFile('comments.infinityexport');
    s.pathQueue.push(file);
    await s.portability.exportPortable(CTX);
    const b = await setupServices();
    b.pathQueue.push(file);
    await b.portability.importPortable(CTX);

    const imported = b.hierarchy.list().notes.find((n) => n.title === 'Plan')!;
    const [t] = b.comments.list({ kind: 'note', id: imported.id }).threads;
    expect(t!.id).not.toBe(thread.id);
    expect(t).toMatchObject({ quote: 'budget', anchor: { type: 'text' } });
    expect(t!.resolvedAt).not.toBeNull();
    expect(t!.comments.map((c) => c.body)).toEqual(['Check the numbers', 'Second']);
    const content = b.row<{ content_json: string }>('SELECT content_json FROM notes WHERE id = ?', imported.id)!.content_json;
    expect(content).toContain(t!.id);
    expect(content).not.toContain(thread.id);
    const deck = b.hierarchy.list().documents.find((d) => d.title === 'Deck')!;
    expect(b.comments.list({ kind: 'document', id: deck.id }).threads[0]).toMatchObject({ anchor: { type: 'slide', slide: 2 } });
  });

  it('a backup restores the threads as they were', async () => {
    const { s, note, thread } = await noteWithThread();
    const file = tmpFile('comments.infinitybackup');
    s.pathQueue.push(file);
    await s.portability.createBackup(CTX);

    const b = await cleanProfile();
    b.pathQueue.push(file);
    await b.portability.prepareRestore(CTX);
    await b.portability.restore();
    await new Promise((resolve) => setImmediate(resolve));
    const { restore, services: r } = await restartWithRestore(b);
    expect(restore?.status).toBe('restored');
    expect(r.comments.list({ kind: 'note', id: note.id }).threads.map((t) => t.id)).toEqual([thread.id]);
  });
});
