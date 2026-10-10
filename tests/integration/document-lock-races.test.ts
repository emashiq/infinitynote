import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAll } from '../../src/main/documents/byte-source';
import type { DocumentStore } from '../../src/main/documents/document-store';
import { open } from '../../src/main/locks/note-crypto';
import { DOCUMENT_LOCK_MESSAGES } from '../../src/shared/contracts/locks';
import { COMMON, CTX, fixtureBytes, rejection, setupDocuments } from './document-helpers';

/**
 * Locked documents under concurrency (D-185 repairs B1, m1, m2, m4): the vault's key is taken only at the moment bytes
 * are sealed or opened, and content changes of a document (saves, restores, lock, remove lock, relock) run one at a
 * time, so no save is ever sealed with a dropped (zeroed) key and no plaintext blob outlives a lock.
 */
const PASSWORD = 'correct horse battery';
const EDITED = fixtureBytes('sample-rich.docx');

/** Holds every sealed write at the point after the save took its sealer and before the bytes are sealed. */
function gateSealedWrites(store: DocumentStore) {
  const original = store.putSealed.bind(store);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => (reached = resolve));
  store.putSealed = async (kind, bytes, seal) => {
    reached();
    await gate;
    return original(kind, bytes, seal);
  };
  return { waiting, release };
}

async function unlockedDocx() {
  const d = await setupDocuments();
  const { s } = d;
  const { document } = await s.documents.createBlank('docx', COMMON, 'Race');
  await s.documents.save({ documentId: document.id, baseRevision: 0, bytes: fixtureBytes('sample.docx') });
  await s.documentLocks.lock({ documentId: document.id, password: PASSWORD, hello: false, copyIn: false });
  await s.documentLocks.unlock({ documentId: document.id, password: PASSWORD });
  return { ...d, id: document.id };
}

/** The current blob never opens with an all-zero key, and opens with the real one (through the password). */
async function expectReadableOnlyWithPassword(d: Awaited<ReturnType<typeof unlockedDocx>>, expected: Buffer) {
  const { s, documentRow, blobFile, id } = d;
  const stored = fs.readFileSync(blobFile(documentRow(id)!.blob_id!));
  expect(() => open(Buffer.alloc(32), 'document', id, stored)).toThrow();
  if (!s.documentLocks.status(id).unlocked) await s.documentLocks.unlock({ documentId: id, password: PASSWORD });
  expect(Buffer.from(await readAll((await s.documents.sourceOf(id)).source))).toEqual(expected);
}

describe('locked documents under concurrency (D-185)', () => {
  it('a relock while a sealed save is under way waits for it: the save is sealed with the real key', async () => {
    const d = await unlockedDocx();
    const { s, id, documentRow } = d;
    const gate = gateSealedWrites(s.documentStore);
    const saving = s.documents.save({ documentId: id, baseRevision: documentRow(id)!.revision, bytes: EDITED });
    await gate.waiting;
    const relocking = s.documentLocks.relock([id], 'idle');
    await Promise.resolve();
    expect(s.documentLocks.status(id).unlocked).toBe(true);
    gate.release();
    await expect(saving).resolves.toMatchObject({ document: { locked: true } });
    await relocking;
    expect(s.documentLocks.status(id).unlocked).toBe(false);
    await expectReadableOnlyWithPassword(d, EDITED);
  });

  it('a key dropped outright while a save waits (quit) refuses the save; nothing is sealed with zeros', async () => {
    const d = await unlockedDocx();
    const { s, id, documentRow } = d;
    const before = documentRow(id)!;
    const gate = gateSealedWrites(s.documentStore);
    const saving = s.documents.save({ documentId: id, baseRevision: before.revision, bytes: EDITED });
    await gate.waiting;
    s.locks.stop();
    gate.release();
    expect(await rejection(saving)).toMatchObject({ code: 'FORBIDDEN', message: DOCUMENT_LOCK_MESSAGES.lockedDuringSave, details: { locked: true } });
    expect(documentRow(id)).toMatchObject({ revision: before.revision, blob_id: before.blob_id });
    await expectReadableOnlyWithPassword(d, fixtureBytes('sample.docx'));
  });

  it('unlocking again while a save waits (a new key buffer) still seals with the real key', async () => {
    const d = await unlockedDocx();
    const { s, id, documentRow } = d;
    const gate = gateSealedWrites(s.documentStore);
    const saving = s.documents.save({ documentId: id, baseRevision: documentRow(id)!.revision, bytes: EDITED });
    await gate.waiting;
    await s.documentLocks.unlock({ documentId: id, password: PASSWORD });
    gate.release();
    await saving;
    await expectReadableOnlyWithPassword(d, EDITED);
  });

  it('removing the lock while a sealed save is under way waits for it, then opens the saved bytes', async () => {
    const d = await unlockedDocx();
    const { s, id, documentRow } = d;
    const gate = gateSealedWrites(s.documentStore);
    const saving = s.documents.save({ documentId: id, baseRevision: documentRow(id)!.revision, bytes: EDITED });
    await gate.waiting;
    const removing = s.documentLocks.remove({ documentId: id, password: PASSWORD });
    gate.release();
    await saving;
    expect(await removing).toMatchObject({ locked: false });
    expect(s.rows('SELECT id FROM document_blobs WHERE sealed = 1')).toEqual([]);
    expect(Buffer.from(await readAll((await s.documents.sourceOf(id)).source))).toEqual(EDITED);
  });

  it('a plaintext save under way when the document is locked is sealed by the lock; no plaintext blob stays (m1)', async () => {
    const { s, documentRow } = await setupDocuments();
    const { document } = await s.documents.createBlank('docx', COMMON, 'Plain');
    const original = s.documentStore.putBytes.bind(s.documentStore);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    s.documentStore.putBytes = async (kind, bytes) => {
      await gate;
      return original(kind, bytes);
    };
    const saving = s.documents.save({ documentId: document.id, baseRevision: 0, bytes: EDITED });
    const locking = s.documentLocks.lock({ documentId: document.id, password: PASSWORD, hello: false, copyIn: false });
    await new Promise((r) => setTimeout(r, 20));
    release();
    await saving;
    await locking;
    expect(s.rows<{ sealed: number }>('SELECT sealed FROM document_blobs')).toEqual([{ sealed: 1 }]);
    const files = fs.readdirSync(path.join(s.dataDir, 'documents'), { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    expect(files.map((f) => path.extname(f.name))).toEqual(['.sealed']);
    await s.documentLocks.unlock({ documentId: document.id, password: PASSWORD });
    expect(Buffer.from(await readAll((await s.documents.sourceOf(document.id)).source))).toEqual(EDITED);
    expect(documentRow(document.id)!.revision).toBe(1);
  });

  it('a document that locks again during a read says it is locked, not damaged (m4)', async () => {
    const { s, id } = await unlockedDocx();
    const original = s.documentStore.read.bind(s.documentStore);
    s.documentStore.read = async (blobId) => {
      const bytes = await original(blobId);
      s.locks.stop();
      return bytes;
    };
    expect(await rejection(s.documents.sourceOf(id))).toMatchObject({ code: 'FORBIDDEN', details: { locked: true } });
  });

  it('Save a copy of a locked document is refused (m3); its cell comment anchors are sealed (m5); the graph marks it (m7)', async () => {
    const { s } = await setupDocuments();
    const { document } = await s.documents.createBlank('xlsx', COMMON, 'Pay');
    s.comments.create({ target: { kind: 'document', id: document.id }, anchor: { type: 'cell', sheet: 'Salaries2026', row: 1, col: 2 }, quote: '', body: 'Check' });
    await s.documentLocks.lock({ documentId: document.id, password: PASSWORD, hello: false, copyIn: false });
    expect(s.rows<{ anchor_json: string }>('SELECT anchor_json FROM comment_threads').map((t) => t.anchor_json).join()).not.toContain('Salaries2026');
    await s.documentLocks.unlock({ documentId: document.id, password: PASSWORD });
    expect(s.comments.list({ kind: 'document', id: document.id }).threads[0]).toMatchObject({ anchor: { type: 'cell', sheet: 'Salaries2026', row: 1, col: 2 } });
    s.comments.create({ target: { kind: 'document', id: document.id }, anchor: { type: 'cell', sheet: 'Bonus', row: 0, col: 0 }, quote: '', body: 'New' });
    expect(s.rows<{ anchor_json: string }>('SELECT anchor_json FROM comment_threads').map((t) => t.anchor_json).join()).not.toContain('Bonus');
    expect(() => s.t.db.prepare("UPDATE comment_threads SET anchor_json = '{\"type\":\"cell\",\"sheet\":\"x\",\"row\":0,\"col\":0}'").run()).toThrow(/must be encrypted/);

    expect((await rejection(s.documents.saveCopy({ documentId: document.id, bytes: fixtureBytes('sample.xlsx') }, CTX))).message).toBe(DOCUMENT_LOCK_MESSAGES.noCopyInside);
    expect(s.graph.build({ scope: { kind: 'all' }, kinds: ['note', 'document'], tag: null, includeOrphans: true }).nodes.find((n) => n.id === document.id)).toMatchObject({ locked: true });

    // Removing the lock opens the anchors again.
    await s.documentLocks.remove({ documentId: document.id, password: PASSWORD });
    expect(s.rows<{ anchor_json: string }>('SELECT anchor_json FROM comment_threads').map((t) => t.anchor_json).join()).toContain('Salaries2026');
  });
});
