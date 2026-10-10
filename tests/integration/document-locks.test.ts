import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAll } from '../../src/main/documents/byte-source';
import { createDocumentHandler } from '../../src/main/windows/document-protocol';
import { documentUrl } from '../../src/shared/app-identity';
import { DOCUMENT_LOCK_MESSAGES, LOCK_MESSAGES } from '../../src/shared/contracts/locks';
import { COMMON, CTX, fixtureBytes, rejection, setupDocuments } from './document-helpers';

const PASSWORD = 'correct horse battery';
const lockReq = (documentId: string, copyIn = false) => ({ documentId, password: PASSWORD, hello: false, copyIn });

/** A Word document with a saved earlier version, indexed text and a comment: everything a lock must not leave readable. */
async function lockableDocx() {
  const d = await setupDocuments();
  const { s } = d;
  const { document } = await s.documents.createBlank('docx', COMMON, 'Handbook');
  await s.documents.save({ documentId: document.id, baseRevision: 0, bytes: fixtureBytes('sample.docx') });
  s.comments.create({ target: { kind: 'document', id: document.id }, anchor: { type: 'paragraph', paragraph: 0 }, quote: 'Project handbook', body: 'Check the budget' });
  const handler = createDocumentHandler({ documents: s.documents, allowedOrigins: [] });
  const get = (init: RequestInit = {}, url = documentUrl(document.id, 0)) => handler(new Request(url, init));
  return { ...d, document, get };
}

const storedFiles = (dataDir: string): string[] =>
  fs.readdirSync(path.join(dataDir, 'documents'), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));

describe('locking a document (D-185)', () => {
  it('seals the bytes, destroys the plaintext versions, text and blobs, seals comments; the database refuses plaintext', async () => {
    const { s, document, documentRow, blobFile } = await lockableDocx();
    const before = documentRow(document.id)!;
    const plaintextBlobs = s.rows<{ id: string }>('SELECT id FROM document_blobs');
    expect(plaintextBlobs).toHaveLength(2);
    expect(s.search.query({ query: 'twelve' }).documents).toHaveLength(1);

    expect(await s.documentLocks.lock(lockReq(document.id))).toEqual({ documentId: document.id, locked: true, unlocked: false, hello: false, retryInSeconds: 0 });
    const after = documentRow(document.id)!;
    expect(after.blob_id).not.toBe(before.blob_id);
    expect(after.body_text).toBe('');
    expect(after.size_bytes).toBe(fixtureBytes('sample.docx').length);
    expect(s.row<{ locked: number }>('SELECT locked FROM documents WHERE id = ?', document.id)!.locked).toBe(1);
    expect(s.rows('SELECT id FROM document_versions WHERE document_id = ?', document.id)).toEqual([]);
    // The old plaintext blobs are gone at once, rows and files; only the sealed blob is stored.
    expect(s.rows<{ id: string; sealed: number }>('SELECT id, sealed FROM document_blobs')).toEqual([{ id: after.blob_id, sealed: 1 }]);
    const files = storedFiles(s.dataDir);
    expect(files).toEqual([blobFile(after.blob_id!)]);
    const stored = fs.readFileSync(files[0]!);
    expect(stored.includes(Buffer.from('PK'))).toBe(false);
    expect(stored.includes(Buffer.from('word/document.xml'))).toBe(false);
    // Search finds the title only; the comment has no readable quote or body.
    expect(s.search.query({ query: 'twelve' }).documents).toHaveLength(0);
    expect(s.search.query({ query: 'Handbook' }).documents.map((r) => r.document.id)).toEqual([document.id]);
    expect(s.rows('SELECT quote FROM comment_threads WHERE target_id = ? AND quote IS NOT NULL', document.id)).toEqual([]);
    expect(s.rows('SELECT body FROM comments WHERE body IS NOT NULL')).toEqual([]);
    expect(s.documentLocked).toEqual([]);

    // The schema itself keeps plaintext out of a locked document.
    expect(() => s.t.db.prepare("UPDATE documents SET body_text = 'leak' WHERE id = ?").run(document.id)).toThrow(/must be encrypted/);
    expect(() => s.t.db.prepare('UPDATE documents SET blob_id = ? WHERE id = ?').run(plaintextBlobs[0]!.id, document.id)).toThrow();
    expect((await rejection(s.documentLocks.lock(lockReq(document.id)))).message).toBe(DOCUMENT_LOCK_MESSAGES.alreadyLocked);
  });

  it('serves the bytes only while unlocked, from memory; a wrong password is refused and slowed down', async () => {
    const { s, document, get } = await lockableDocx();
    await s.documentLocks.lock(lockReq(document.id));
    expect((await get()).status).toBe(403);
    expect((await rejection(s.documents.sourceOf(document.id))).code).toBe('FORBIDDEN');
    // Three free attempts, then a growing wait, as for notes.
    for (let i = 0; i < 3; i += 1) {
      expect(await rejection(s.documentLocks.unlock({ documentId: document.id, password: 'wrong password' }))).toMatchObject({ message: LOCK_MESSAGES.wrongPassword });
    }
    expect(s.documentLocks.status(document.id).retryInSeconds).toBeGreaterThan(0);
    s.clock.advance(60_000);
    expect(await s.documentLocks.unlock({ documentId: document.id, password: PASSWORD })).toMatchObject({ locked: true, unlocked: true });

    const whole = await get();
    expect(whole.status).toBe(200);
    expect(whole.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(fixtureBytes('sample.docx'));
    const part = await get({ headers: { Range: 'bytes=0-3' } });
    expect(part.status).toBe(206);
    expect(Buffer.from(await part.arrayBuffer())).toEqual(fixtureBytes('sample.docx').subarray(0, 4));
    // Readers in main get the bytes in memory, never a file path.
    expect(typeof (await s.documents.sourceOf(document.id)).source).not.toBe('string');
  });

  it('saves while unlocked are sealed, keep sealed versions and no text; restore and export work; copies inside are refused', async () => {
    const { s, document } = await lockableDocx();
    await s.documentLocks.lock(lockReq(document.id));
    await s.documentLocks.unlock({ documentId: document.id, password: PASSWORD });
    const blank = await readAll((await s.documents.sourceOf(document.id)).source);
    const saved = await s.documents.save({ documentId: document.id, baseRevision: 1, bytes: fixtureBytes('sample-rich.docx') });
    expect(saved.document).toMatchObject({ revision: 2, locked: true });
    expect(s.rows<{ sealed: number }>('SELECT b.sealed FROM document_versions v JOIN document_blobs b ON b.id = v.blob_id WHERE v.document_id = ?', document.id)).toEqual([{ sealed: 1 }]);
    expect(s.rows<{ sealed: number }>('SELECT sealed FROM document_blobs')).toEqual([{ sealed: 1 }, { sealed: 1 }]);
    expect(s.row<{ body_text: string }>('SELECT body_text FROM documents WHERE id = ?', document.id)!.body_text).toBe('');
    expect(Buffer.from(await readAll((await s.documents.sourceOf(document.id)).source))).toEqual(fixtureBytes('sample-rich.docx'));

    const [version] = s.documents.versionsOf(document.id).versions;
    await s.documents.restoreVersion({ documentId: document.id, versionId: version!.id, baseRevision: 2 });
    expect(Buffer.from(await readAll((await s.documents.sourceOf(document.id)).source))).toEqual(Buffer.from(blank));

    const target = path.join(s.t.dir, 'exported.docx');
    s.pathQueue.push(target);
    await s.documents.exportCopy({ documentId: document.id }, CTX);
    expect(fs.readFileSync(target)).toEqual(Buffer.from(blank));

    expect((await rejection(s.documents.openExternal(document.id))).message).toBe(DOCUMENT_LOCK_MESSAGES.noSystemApp);
    expect((await rejection(s.documents.showInFolder(document.id))).message).toBe(DOCUMENT_LOCK_MESSAGES.noSystemApp);
    expect((await rejection(s.documents.copyVersion(document.id, s.documents.versionsOf(document.id).versions[0]!.id))).message).toBe(DOCUMENT_LOCK_MESSAGES.noCopyInside);
    // Comments stay readable while unlocked, and new ones are sealed.
    expect(s.comments.list({ kind: 'document', id: document.id }).threads[0]).toMatchObject({ quote: 'Project handbook' });
    s.comments.create({ target: { kind: 'document', id: document.id }, anchor: { type: 'paragraph', paragraph: 1 }, quote: 'Second', body: 'Sealed too' });
    expect(s.rows('SELECT body FROM comments WHERE body IS NOT NULL')).toEqual([]);
  });

  it('locks again after the idle time (work in it counts as use), with Lock now and Lock all; open edits are saved first', async () => {
    const { s, document } = await lockableDocx();
    s.settings.set('locks.autoLockMinutes', 1);
    await s.documentLocks.lock(lockReq(document.id));
    await s.documentLocks.unlock({ documentId: document.id, password: PASSWORD });
    s.clock.advance(50_000);
    s.documentLocks.activity(document.id);
    s.clock.advance(20_000);
    expect(await s.locks.sweep()).toBe(0);
    expect(s.documentLocks.status(document.id).unlocked).toBe(true);
    s.clock.advance(61_000);
    expect(await s.locks.sweep()).toBe(1);
    expect(s.documentLocks.status(document.id).unlocked).toBe(false);
    expect(s.documentEditSaves.count).toBe(1);
    expect(s.documentLocked).toEqual([document.id]);
    expect((await rejection(s.documents.sourceOf(document.id))).code).toBe('FORBIDDEN');

    await s.documentLocks.unlock({ documentId: document.id, password: PASSWORD });
    expect(await s.documentLocks.lockNow(document.id)).toMatchObject({ unlocked: false });
    await s.documentLocks.unlock({ documentId: document.id, password: PASSWORD });
    expect(await s.locks.lockAll()).toBe(1);
    expect(s.documentLocks.status(document.id).unlocked).toBe(false);
    expect(s.documentEditSaves.count).toBe(3);
    expect(s.documentLocked).toEqual([document.id, document.id, document.id]);
  });

  it('a linked document is copied in to be locked, within the copy limit; its original stays where it is', async () => {
    const { s, importFile, original, documentRow } = await setupDocuments();
    const file = original('Plan.pdf');
    const linked = await importFile(file, 'link');
    expect((await rejection(s.documentLocks.lock(lockReq(linked.id)))).message).toBe(DOCUMENT_LOCK_MESSAGES.linkedNeedsCopy);
    s.settings.set('attachments.documentMaxMb', 1);
    fs.appendFileSync(file, Buffer.alloc(1024 * 1024 + 1));
    const big = await importFile(file, 'link');
    expect(await rejection(s.documentLocks.lock(lockReq(big.id, true)))).toMatchObject({ code: 'LIMIT_EXCEEDED', message: DOCUMENT_LOCK_MESSAGES.linkedTooLarge(1) });

    const small = await importFile(original('Small.pdf'), 'link');
    await s.documentLocks.lock(lockReq(small.id, true));
    expect(documentRow(small.id)).toMatchObject({ linked_file_id: null });
    expect(s.row<{ storage: string }>('SELECT storage FROM documents WHERE id = ?', small.id)!.storage).toBe('managed');
    expect(fs.readFileSync(path.join(path.dirname(file), 'Small.pdf'))).toEqual(fixtureBytes('sample.pdf'));
  });

  it('removing the lock stores the bytes, versions and comments unencrypted again and indexes the text', async () => {
    const { s, document } = await lockableDocx();
    await s.documentLocks.lock(lockReq(document.id));
    await s.documentLocks.unlock({ documentId: document.id, password: PASSWORD });
    await s.documents.save({ documentId: document.id, baseRevision: 1, bytes: fixtureBytes('sample.docx') });
    expect((await rejection(s.documentLocks.remove({ documentId: document.id, password: 'wrong password' }))).message).toBe(LOCK_MESSAGES.wrongPassword);
    s.clock.advance(60_000);
    expect(await s.documentLocks.remove({ documentId: document.id, password: PASSWORD })).toMatchObject({ locked: false, unlocked: false });
    expect(s.rows<{ sealed: number }>('SELECT sealed FROM document_blobs ORDER BY sealed')).toEqual([{ sealed: 0 }]);
    expect(s.documents.versionsOf(document.id).versions).toHaveLength(1);
    expect(s.search.query({ query: 'twelve' }).documents).toHaveLength(1);
    expect(s.comments.list({ kind: 'document', id: document.id }).threads[0]).toMatchObject({ quote: 'Project handbook' });
    expect(Buffer.from(await readAll((await s.documents.sourceOf(document.id)).source))).toEqual(fixtureBytes('sample.docx'));
    expect(s.documentLocked).toEqual([]);
  });

  it('a locked spreadsheet opens in the editor while unlocked, its bytes going to the worker in memory', async () => {
    const { s } = await setupDocuments();
    const { document } = await s.documents.createBlank('xlsx', COMMON, 'Budget');
    await s.documentLocks.lock(lockReq(document.id));
    expect((await rejection(s.spreadsheets.read(document.id))).code).toBe('FORBIDDEN');
    await s.documentLocks.unlock({ documentId: document.id, password: PASSWORD });
    const read = await s.spreadsheets.read(document.id);
    await s.spreadsheets.save({ documentId: document.id, baseRevision: 0, workbook: read.workbook });
    expect(s.rows<{ sealed: number }>('SELECT sealed FROM document_blobs')).toEqual([{ sealed: 1 }, { sealed: 1 }]);
  });

  it('Export all notes leaves locked documents out and counts them', async () => {
    const { s } = await lockableDocx();
    const { document: open } = await s.documents.createBlank('xlsx', COMMON, 'Open sheet');
    const locked = s.rows<{ id: string }>("SELECT id FROM documents WHERE title = 'Handbook'")[0]!.id;
    await s.documentLocks.lock(lockReq(locked));
    const target = path.join(s.t.dir, 'export.infinity-notes');
    s.pathQueue.push(target);
    const result = await s.portability.exportPortable(CTX);
    expect(result).toMatchObject({ canceled: false, skippedLocked: 1, counts: { documents: 1 } });
    expect(open.id).toBeTruthy();
  });
});
