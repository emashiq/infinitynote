import { describe, expect, it } from 'vitest';
import { linkedInsteadMessage } from '../../../../src/shared/attachments/limits';
import { DOCUMENT_MESSAGES } from '../../../../src/shared/documents/messages';
import { DocumentController } from '../../../../src/renderer/documents/document-controller';
import { DOCUMENT_SAVE_FAILED_NOTICE } from '../../../../src/renderer/state/tabs-store';
import { recentItems } from '../../../../src/renderer/home/RecentSection';
import { createFakeBridge } from '../support/fake-bridge';
import { flushMicrotasks, setupServices } from '../support/services';

const COMMON = { projectId: null, folderId: null };
const MB = 1024 * 1024;

describe('DocumentController (D-118)', () => {
  it('opens a document, saves with its revision and the linked original state, and keeps a conflict for the view', async () => {
    const fake = createFakeBridge();
    const file = { path: '/home/me/Plan.xlsx', state: 'available' as const, sizeBytes: 10, modifiedAt: 1234 };
    const doc = fake.addDocument({ projectId: null, folderId: null, title: 'Plan', kind: 'xlsx', storage: 'linked', sizeBytes: 10 }, file);
    const c = new DocumentController(fake.bridge, doc.id);
    expect(c.store.getState().status).toBe('loading');
    await c.open();
    expect(c.store.getState()).toMatchObject({ status: 'ready', document: { title: 'Plan', revision: 0 }, file, loads: 1 });
    expect(c.sourceUrl()).toBe(`infinity-document://${doc.id}/?r=0`);

    expect(await c.save(new Uint8Array([1, 2, 3]))).toEqual({ ok: true });
    expect(fake.callsTo('document:save').at(-1)?.req).toMatchObject({ documentId: doc.id, baseRevision: 0, expectedFile: { sizeBytes: 10, modifiedAt: 1234 } });
    expect(c.store.getState()).toMatchObject({ document: { revision: 1, sizeBytes: 3 }, saving: false, conflict: null, loads: 1 });
    expect(c.sourceUrl()).toBe(`infinity-document://${doc.id}/?r=1`);

    fake.failNext('document:save', { code: 'CONFLICT', message: DOCUMENT_MESSAGES.changedOnDisk, details: { reason: 'changedOnDisk' } });
    expect(await c.save(new Uint8Array([4]))).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(c.store.getState().conflict).toEqual({ reason: 'changedOnDisk', message: DOCUMENT_MESSAGES.changedOnDisk });
    await c.reload();
    expect(c.store.getState()).toMatchObject({ conflict: null, loads: 2 });

    fake.failNext('document:save', { code: 'INTERNAL', message: DOCUMENT_MESSAGES.saveFailed });
    expect(await c.save(new Uint8Array([5]))).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(c.store.getState().conflict).toBeNull();
  });

  it('a managed document is saved without an expected file; Save a copy answers the new document', async () => {
    const fake = createFakeBridge();
    const doc = fake.addDocument({ projectId: null, folderId: null, title: 'Letter', kind: 'docx', storage: 'managed', sizeBytes: 5 });
    const c = new DocumentController(fake.bridge, doc.id);
    await c.open();
    await c.save(new Uint8Array([9]));
    expect(fake.callsTo('document:save').at(-1)?.req).not.toHaveProperty('expectedFile');
    expect(await c.saveCopy(new Uint8Array([9]))).toMatchObject({ document: { title: 'Letter (copy)', storage: 'linked' } });
  });

  it('a trashed or missing document opens as such', async () => {
    const fake = createFakeBridge();
    const doc = fake.addDocument({ projectId: null, folderId: null, title: 'Old', kind: 'pdf', storage: 'managed', sizeBytes: 5 });
    await fake.bridge.document.trash({ documentId: doc.id });
    const trashed = new DocumentController(fake.bridge, doc.id);
    await trashed.open();
    expect(trashed.store.getState()).toMatchObject({ status: 'trashed', message: DOCUMENT_MESSAGES.inTrash, document: null });
    const missing = new DocumentController(fake.bridge, '00000000-0000-4000-8000-00000000ffff');
    await missing.open();
    expect(missing.store.getState().status).toBe('missing');
  });
});

describe('document commands and tabs', () => {
  it('a blank document is created where the user works and opens in a tab', async () => {
    const { services, fake } = await setupServices();
    await services.commands.run('document.newXlsx');
    const [doc] = fake.data.documents;
    expect(doc).toMatchObject({ kind: 'xlsx', title: 'Untitled spreadsheet', projectId: null });
    expect(services.tabs.store.getState().session.activeTabId).toBe(`document:${doc!.id}`);
    expect(services.tree.store.getState().model.nodes.get(`document:${doc!.id}`)).toMatchObject({ kind: 'document', documentKind: 'xlsx', parentKey: 'common' });
  });

  it('Import file asks how to add the files while "When adding files" is Ask', async () => {
    const { services, fake } = await setupServices();
    fake.data.documentPicks.push([{ name: 'a.pdf', sizeBytes: 10 }]);
    await services.commands.run('document.import');
    expect(services.ui.store.getState().dialog).toMatchObject({ kind: 'importDocuments', picked: { files: [{ name: 'a.pdf', sizeBytes: 10 }] }, location: COMMON });
    expect(fake.callsTo('document:addPicked')).toEqual([]);
  });

  it('Always copy links a file over the copy limit with a notice, and opens the first added document', async () => {
    const { services, fake } = await setupServices();
    services.attachmentPrefs.setState({ addFiles: 'copy', documentMaxMb: 25 });
    fake.data.documentPicks.push([
      { name: 'small.pdf', sizeBytes: 10 },
      { name: 'huge.pdf', sizeBytes: 30 * MB },
    ]);
    await services.commands.run('document.import');
    expect(fake.callsTo('document:addPicked').map((c) => (c.req as { action: string; index: number }).action)).toEqual(['copy', 'link']);
    expect(services.notices.store.getState().notices.map((n) => n.text)).toContain(linkedInsteadMessage('huge.pdf', 25));
    const first = fake.data.documents[0]!;
    expect(services.tabs.store.getState().session.activeTabId).toBe(`document:${first.id}`);
  });

  it('refused files are reported once per reason and a canceled pick does nothing', async () => {
    const { services, fake } = await setupServices();
    await services.commands.run('document.import');
    expect(fake.callsTo('document:addPicked')).toEqual([]);
    fake.failNext('document:pickFiles', { code: 'INTERNAL', message: 'picker failed' });
    await services.commands.run('document.import');
    expect(services.notices.store.getState().notices.map((n) => n.text)).toContain('picker failed');
  });

  it('trashing an open document closes its tab', async () => {
    const { services, fake } = await setupServices();
    const doc = fake.addDocument({ projectId: null, folderId: null, title: 'Deck', kind: 'pptx', storage: 'managed', sizeBytes: 5 });
    await services.tree.reload();
    await services.tabs.openDocument(doc.id);
    expect(services.tabs.store.getState().session.tabs.map((t) => t.id)).toContain(`document:${doc.id}`);
    await services.tree.trashDocument(doc.id);
    await flushMicrotasks(20);
    expect(services.tabs.store.getState().session.tabs.map((t) => t.id)).toEqual(['home']);
    expect(services.notices.store.getState().notices.map((n) => n.text)).toContain('1 tab was closed because its document is in Trash');
  });

  it('opens a document at a page: each request is new for the viewer, and Ctrl+F in its tab counts up (D-130, D-132)', async () => {
    const { services, fake } = await setupServices();
    const doc = fake.addDocument({ projectId: null, folderId: null, title: 'Paper', kind: 'pdf', storage: 'managed', sizeBytes: 5 });
    await services.tree.reload();
    await services.tabs.openDocument(doc.id);
    expect(services.tabs.documentTargets.getState()[doc.id]).toBeUndefined();
    await services.tabs.openDocument(doc.id, { target: { page: 3 } });
    expect(services.tabs.documentTargets.getState()[doc.id]).toEqual({ target: { page: 3 }, seq: 1 });
    await services.tabs.openDocument(doc.id, { target: { page: 3 } });
    expect(services.tabs.documentTargets.getState()[doc.id]).toEqual({ target: { page: 3 }, seq: 2 });
    await services.commands.run('note.find');
    await services.commands.run('note.find');
    expect(services.ui.store.getState().documentFind).toEqual({ documentId: doc.id, seq: 2 });
    expect(services.ui.store.getState().focusRequest).toBeNull();
  });

  it('a document tab with unsaved edits saves them before switching, and stays when the save fails', async () => {
    const { services, fake } = await setupServices();
    const doc = fake.addDocument({ projectId: null, folderId: null, title: 'Sheet', kind: 'xlsx', storage: 'managed', sizeBytes: 5 });
    await services.tree.reload();
    await services.tabs.openDocument(doc.id);
    const results = [false, true, true];
    let flushes = 0;
    services.tabs.setDocumentEdits({ documentId: doc.id, flush: async () => (flushes++, results.shift() ? { ok: true } : { ok: false, code: 'INTERNAL', message: 'x' }) });
    expect(await services.tabs.activate('home')).toBe(false);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`document:${doc.id}`);
    expect(services.notices.store.getState().notices.map((n) => n.text)).toContain(DOCUMENT_SAVE_FAILED_NOTICE);
    expect(await services.tabs.flushActive()).toEqual({ ok: true });
    expect(await services.tabs.activate('home')).toBe(true);
    expect(flushes).toBe(3);
    // The edits belonged to the tab that was left: Home has nothing to flush.
    expect(await services.tabs.flushActive()).toEqual({ ok: true });
    expect(flushes).toBe(3);
  });

  it('Home lists recent notes and documents together, newest first', () => {
    const at = (updatedAt: number, id: string) => ({ id, updatedAt });
    const notes = [at(5, 'n5'), at(1, 'n1')] as never[];
    const documents = [at(7, 'd7'), at(3, 'd3')] as never[];
    expect(recentItems(notes, documents).map((r) => `${r.kind}:${r.item.id}`)).toEqual(['document:d7', 'note:n5', 'document:d3', 'note:n1']);
  });
});
