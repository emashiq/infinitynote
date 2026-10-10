import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { blankDocument } from '../../src/main/documents/blank-documents';
import { LATEST } from '../../src/main/db/migrations';
import { ATTACHMENT_GC_GRACE_MS } from '../../src/main/services/retention-policy';
import { fileTooLarge } from '../../src/shared/attachments/limits';
import { LINK_MESSAGES } from '../../src/shared/contracts/attachments';
import { DOCUMENT_MESSAGES } from '../../src/shared/documents/messages';
import { paragraph, saveDoc } from './portability-helpers';
import { COMMON, CTX, fixtureBytes, rejection, setupDocuments } from './document-helpers';

const MB = 1024 * 1024;

describe('migration 011 documents (D-118)', () => {
  it('creates the document tables with their checks, cascades versions with their document and indexes live rows only', async () => {
    const { s, importFile, original } = await setupDocuments();
    expect(LATEST).toBeGreaterThanOrEqual(11);
    const doc = await importFile(original('Report.docx'), 'copy');
    const blobId = s.row<{ blob_id: string }>('SELECT blob_id FROM documents WHERE id = ?', doc.id)!.blob_id;
    const insert = (over: Record<string, unknown>) => {
      const row = { id: randomUUID(), title: 'x', kind: 'pdf', storage: 'managed', blob_id: blobId, linked_file_id: null, size_bytes: 1, ...over };
      s.t.db
        .prepare('INSERT INTO documents(id, title, kind, storage, blob_id, linked_file_id, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)')
        .run(row.id, row.title, row.kind, row.storage, row.blob_id, row.linked_file_id, row.size_bytes);
    };
    expect(() => insert({ kind: 'exe' })).toThrow(/CHECK/);
    expect(() => insert({ title: '' })).toThrow(/CHECK/);
    expect(() => insert({ storage: 'linked' })).toThrow(/CHECK/);
    expect(() => insert({ blob_id: null })).toThrow(/CHECK/);
    expect(() => insert({ blob_id: randomUUID() })).toThrow(/FOREIGN KEY/);
    expect(() => s.t.db.prepare("INSERT INTO document_blobs(id, sha256, relative_path, size_bytes, created_at) VALUES (?, ?, 'documents/ab/../../x', 1, 1)").run(randomUUID(), 'f'.repeat(64))).toThrow(/CHECK/);
    await s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: await blankDocument('docx') });
    expect(s.rows('SELECT document_id FROM document_versions')).toHaveLength(1);
    expect(s.rows("SELECT rowid FROM documents_fts WHERE documents_fts MATCH 'Report'")).toHaveLength(1);
    s.trash.trashDocument(doc.id);
    expect(s.rows("SELECT rowid FROM documents_fts WHERE documents_fts MATCH 'Report'")).toHaveLength(0);
    s.t.db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
    expect(s.rows('SELECT * FROM document_versions')).toEqual([]);
  });
});

describe('creating and importing documents (D-118)', () => {
  it('creates blank Word, Excel and PowerPoint files in a folder, stored once per content', async () => {
    const { s, blobFile } = await setupDocuments();
    const project = s.project('Alpha');
    const folder = s.folder(project.id, null, 'Specs');
    const at = { projectId: project.id, folderId: folder.id };
    const { document: word } = await s.documents.createBlank('docx', at);
    const { document: sheet } = await s.documents.createBlank('xlsx', at, 'Budget');
    const { document: deck } = await s.documents.createBlank('pptx', at);
    const { document: second } = await s.documents.createBlank('docx', at);
    expect([word, sheet, deck].map((d) => [d.title, d.kind, d.storage, d.revision])).toEqual([
      ['Untitled document', 'docx', 'managed', 0],
      ['Budget', 'xlsx', 'managed', 0],
      ['Untitled presentation', 'pptx', 'managed', 0],
    ]);
    const blobs = s.rows<{ blob_id: string }>('SELECT blob_id FROM documents WHERE kind = ? ORDER BY created_at', 'docx').map((r) => r.blob_id);
    expect(blobs[0]).toBe(blobs[1]);
    expect(fs.readFileSync(blobFile(blobs[0]!)).equals(await blankDocument('docx'))).toBe(true);
    expect(s.hierarchy.list().documents.map((d) => d.id).sort()).toEqual([word.id, sheet.id, deck.id, second.id].sort());
    expect(s.events.at(-1)).toEqual({ reason: 'create', trashedNoteIds: [], trashedDocumentIds: [] });
    s.check();
    s.trash.trashFolder(folder.id);
    expect((await rejection(s.documents.createBlank('docx', at))).code).toBe('NOT_FOUND');
  });

  it('import by copy keeps a validated copy in the store and indexes its text; the copy limit applies', async () => {
    const { s, original, importFile, documentRow, blobFile } = await setupDocuments();
    const doc = await importFile(original('Quarterly report.docx'), 'copy');
    expect(doc).toMatchObject({ title: 'Quarterly report', kind: 'docx', storage: 'managed', sizeBytes: fixtureBytes('sample.docx').length });
    const row = documentRow(doc.id)!;
    expect(fs.readFileSync(blobFile(row.blob_id!)).equals(fixtureBytes('sample.docx'))).toBe(true);
    expect(row.body_text).toContain('twelve percent');

    s.settings.set('attachments.documentMaxMb', 1);
    const big = original('big.csv', 'a,b\n'.repeat(300_000));
    expect(await rejection(importFile(big, 'copy'))).toMatchObject({ code: 'LIMIT_EXCEEDED', message: fileTooLarge(1) });
    expect(s.rows('SELECT id FROM documents WHERE title = ?', 'big')).toEqual([]);
  });

  it('refuses a file whose content is not its kind, and files Infinity Notes does not open as documents', async () => {
    const { s, original, importFile } = await setupDocuments();
    const fake = original('invoice.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]));
    expect(await rejection(importFile(fake, 'copy'))).toMatchObject({ code: 'VALIDATION_FAILED', message: DOCUMENT_MESSAGES.damaged('pdf') });
    expect(await rejection(importFile(fake, 'link'))).toMatchObject({ code: 'VALIDATION_FAILED', message: DOCUMENT_MESSAGES.damaged('pdf') });
    s.dialogQueue.push([original('notes.txt', 'plain text'), original('tool.exe', 'MZ')]);
    const pick = await s.documents.pickFiles(CTX);
    expect(pick.files).toEqual([]);
    expect(pick.rejected.map((r) => [r.name, r.code, r.message])).toEqual([
      ['notes.txt', 'UNSUPPORTED', DOCUMENT_MESSAGES.unsupported],
      ['tool.exe', 'UNSUPPORTED', DOCUMENT_MESSAGES.unsupported],
    ]);
    expect(s.dialogCalls.at(-1)?.filter?.extensions).toEqual(['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'html', 'htm']);
    expect(s.rows('SELECT id FROM documents')).toEqual([]);
  });

  it('a pick for documents is added only as documents, once per file', async () => {
    const { s, original } = await setupDocuments();
    s.dialogQueue.push([original('a.pdf')]);
    const pick = await s.documents.pickFiles(CTX);
    expect(await rejection(s.picker.add({ pickId: pick.pickId!, index: 0, action: 'copy' }, CTX))).toMatchObject({ code: 'NOT_FOUND' });
    await s.documents.addPicked({ pickId: pick.pickId!, index: 0, action: 'copy', location: COMMON }, CTX);
    expect((await rejection(s.documents.addPicked({ pickId: pick.pickId!, index: 0, action: 'copy', location: COMMON }, CTX))).code).toBe('NOT_FOUND');
  });

  it('import by link keeps the file where it is, at any size, and records it as a linked file', async () => {
    const { s, original, importFile, documentRow } = await setupDocuments();
    s.settings.set('attachments.documentMaxMb', 1);
    const file = original('Large deck.pptx', fixtureBytes('sample.pptx'));
    const doc = await importFile(file, 'link');
    expect(doc).toMatchObject({ title: 'Large deck', kind: 'pptx', storage: 'linked' });
    const row = documentRow(doc.id)!;
    expect(row.blob_id).toBeNull();
    expect(s.row('SELECT path FROM linked_files WHERE id = ?', row.linked_file_id)).toEqual({ path: file });
    expect(row.body_text).toContain('Welcome slide');
    expect(s.rows('SELECT id FROM document_blobs')).toEqual([]);
    const opened = await s.documents.open(doc.id);
    expect(opened.file).toMatchObject({ path: file, state: 'available', sizeBytes: fs.statSync(file).size });
  });
});

describe('"Open in Infinity Notes" for files in a note', () => {
  it('a file attachment becomes a managed document next to the note, once while it is not in Trash', async () => {
    const { s } = await setupDocuments();
    const project = s.project('Alpha');
    const note = s.note(project.id, null, 'Meeting');
    const { attachment } = await s.attachments.importBytes({ kind: 'document', originalName: 'Minutes.xlsx', bytes: fixtureBytes('sample.xlsx') });
    saveDoc(s, note.id, { type: 'doc', content: [paragraph(randomUUID(), 'See'), { type: 'fileAttachment', attrs: { id: randomUUID(), attachmentId: attachment.id, name: 'Minutes.xlsx', sizeBytes: attachment.sizeBytes, mime: attachment.mime } }] });
    const first = await s.documents.fromAttachment(note.id, attachment.id);
    expect(first).toMatchObject({ created: true, document: { title: 'Minutes', kind: 'xlsx', storage: 'managed', projectId: project.id, folderId: null } });
    expect(await s.documents.fromAttachment(note.id, attachment.id)).toEqual({ created: false, document: first.document });
    s.trash.trashDocument(first.document.id);
    expect((await s.documents.fromAttachment(note.id, attachment.id)).created).toBe(true);
    const other = s.note(null, null, 'Other');
    expect((await rejection(s.documents.fromAttachment(other.id, attachment.id))).code).toBe('NOT_FOUND');
    const { attachment: text } = await s.attachments.importBytes({ kind: 'document', originalName: 'readme.txt', bytes: Buffer.from('hi') });
    saveDoc(s, other.id, { type: 'doc', content: [{ type: 'fileAttachment', attrs: { id: randomUUID(), attachmentId: text.id, name: 'readme.txt', sizeBytes: 2, mime: text.mime } }] });
    expect(await rejection(s.documents.fromAttachment(other.id, text.id))).toMatchObject({ code: 'UNSUPPORTED', message: DOCUMENT_MESSAGES.unsupported });
  });

  it('a linked file becomes a linked document of the same link', async () => {
    const { s, original } = await setupDocuments();
    const note = s.note(null, null, 'Sources');
    const link = await s.links.create(original('Paper.pdf'));
    saveDoc(s, note.id, { type: 'doc', content: [{ type: 'fileLink', attrs: { id: randomUUID(), linkId: link.id, name: link.name, sizeBytes: link.sizeBytes } }] });
    const made = await s.documents.fromLink(note.id, link.id);
    expect(made).toMatchObject({ created: true, document: { title: 'Paper', kind: 'pdf', storage: 'linked' } });
    expect(s.row('SELECT linked_file_id FROM documents WHERE id = ?', made.document.id)).toEqual({ linked_file_id: link.id });
    expect((await s.documents.fromLink(note.id, link.id)).created).toBe(false);
    // The note stops using the link: the document still does, so link GC keeps the record.
    saveDoc(s, note.id, { type: 'doc', content: [paragraph(randomUUID(), 'gone')] });
    s.clock.advance(ATTACHMENT_GC_GRACE_MS * 2);
    expect((await s.maintenance.run()).linkedFilesDeleted).toBe(0);
    expect((await s.documents.open(made.document.id)).file?.state).toBe('available');
  });
});

describe('saving documents', () => {
  it('a managed save stores new bytes, keeps the old ones as a version and re-indexes the text', async () => {
    const { s, documentRow } = await setupDocuments();
    const { document } = await s.documents.createBlank('docx', COMMON, 'Plan');
    const before = documentRow(document.id)!;
    const saved = await s.documents.save({ documentId: document.id, baseRevision: 0, bytes: fixtureBytes('sample.docx') });
    expect(saved).toMatchObject({ document: { revision: 1, sizeBytes: fixtureBytes('sample.docx').length }, file: null });
    const after = documentRow(document.id)!;
    expect(after.blob_id).not.toBe(before.blob_id);
    expect(s.documents.versionsOf(document.id).versions).toMatchObject([{ revision: 0, reason: 'save', sizeBytes: (await blankDocument('docx')).length }]);
    expect(s.search.query({ query: 'twelve' }).documents.map((r) => r.document.id)).toEqual([document.id]);

    const stale = await rejection(s.documents.save({ documentId: document.id, baseRevision: 0, bytes: await blankDocument('docx') }));
    expect(stale).toMatchObject({ code: 'CONFLICT', message: DOCUMENT_MESSAGES.revisionChanged, details: { reason: 'revision', currentRevision: 1 } });
    const damaged = await rejection(s.documents.save({ documentId: document.id, baseRevision: 1, bytes: Buffer.from('not a zip') }));
    expect(damaged).toMatchObject({ code: 'VALIDATION_FAILED', message: DOCUMENT_MESSAGES.damaged('docx') });
    const tooBig = await rejection(s.documents.save({ documentId: document.id, baseRevision: 1, bytes: new Uint8Array(26 * MB) }));
    expect(tooBig).toMatchObject({ code: 'LIMIT_EXCEEDED', message: DOCUMENT_MESSAGES.tooLargeToStore(25) });
    expect(documentRow(document.id)).toEqual(after);
    expect(fs.readdirSync(path.join(s.dataDir, 'documents', 'tmp'))).toEqual([]);
  });

  it('restoring a version puts its bytes back as the next revision and keeps the current ones', async () => {
    const { s, documentRow } = await setupDocuments();
    const { document } = await s.documents.createBlank('xlsx', COMMON);
    const blank = documentRow(document.id)!.blob_id;
    await s.documents.save({ documentId: document.id, baseRevision: 0, bytes: fixtureBytes('sample.xlsx') });
    const [version] = s.documents.versionsOf(document.id).versions;
    const restored = await s.documents.restoreVersion({ documentId: document.id, versionId: version!.id, baseRevision: 1 });
    expect(restored.document.revision).toBe(2);
    expect(documentRow(document.id)!.blob_id).toBe(blank);
    expect(s.documents.versionsOf(document.id).versions.map((v) => [v.revision, v.reason])).toEqual([
      [1, 'restore'],
      [0, 'save'],
    ]);
    expect((await rejection(s.documents.restoreVersion({ documentId: document.id, versionId: randomUUID(), baseRevision: 2 }))).code).toBe('NOT_FOUND');
  });

  it('versions follow the version retention count', async () => {
    const { s } = await setupDocuments();
    s.settings.set('retention.autoVersionMax', 10);
    const { document } = await s.documents.createBlank('docx', COMMON);
    const variants = [fixtureBytes('sample.docx'), await blankDocument('docx')];
    for (let revision = 0; revision < 12; revision += 1) {
      s.tick(1000);
      await s.documents.save({ documentId: document.id, baseRevision: revision, bytes: variants[revision % 2]! });
    }
    expect(s.documents.versionsOf(document.id).versions).toHaveLength(10);
  });

  it('a linked save rewrites the original in place and keeps its previous bytes as a version', async () => {
    const { s, original, importFile, documentRow } = await setupDocuments();
    const file = original('Budget.xlsx');
    const doc = await importFile(file, 'link');
    const opened = await s.documents.open(doc.id);
    const blank = await blankDocument('xlsx');
    const saved = await s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: blank, expectedFile: { sizeBytes: opened.file!.sizeBytes!, modifiedAt: opened.file!.modifiedAt! } });
    expect(fs.readFileSync(file).equals(blank)).toBe(true);
    expect(saved.file).toMatchObject({ path: file, state: 'available', sizeBytes: blank.length });
    expect(saved.document).toMatchObject({ revision: 1, sizeBytes: blank.length, storage: 'linked' });
    expect(documentRow(doc.id)!.body_text).toBe('Sheet1');
    expect(s.row('SELECT size_bytes FROM linked_files WHERE id = ?', documentRow(doc.id)!.linked_file_id)).toEqual({ size_bytes: blank.length });
    const [version] = s.documents.versionsOf(doc.id).versions;
    expect(version).toMatchObject({ revision: 0, reason: 'save', sizeBytes: fixtureBytes('sample.xlsx').length });
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(['Budget.xlsx']);
  });

  it('a linked file changed on disk since it was opened is not overwritten: the save reports the conflict', async () => {
    const { s, original, importFile } = await setupDocuments();
    const file = original('Shared.docx');
    const doc = await importFile(file, 'link');
    const opened = await s.documents.open(doc.id);
    const expectedFile = { sizeBytes: opened.file!.sizeBytes!, modifiedAt: opened.file!.modifiedAt! };
    const theirs = await blankDocument('docx');
    fs.writeFileSync(file, theirs);
    const conflict = await rejection(s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: fixtureBytes('sample.docx'), expectedFile }));
    expect(conflict).toMatchObject({ code: 'CONFLICT', message: DOCUMENT_MESSAGES.changedOnDisk, details: { reason: 'changedOnDisk', file: { sizeBytes: theirs.length } } });
    expect(fs.readFileSync(file).equals(theirs)).toBe(true);
    expect(await rejection(s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: theirs }))).toMatchObject({ code: 'VALIDATION_FAILED' });
    fs.rmSync(file);
    expect(await rejection(s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: theirs, expectedFile }))).toMatchObject({ code: 'NOT_FOUND', message: LINK_MESSAGES.notFound(file) });
  });

  it('Save a copy writes the bytes to a chosen file and adds it as a linked document next to the original', async () => {
    const { s, originals } = await setupDocuments();
    const folder = s.folder(null, null, 'Drafts');
    const { document } = await s.documents.createBlank('docx', { projectId: null, folderId: folder.id }, 'Letter');
    expect(await s.documents.saveCopy({ documentId: document.id, bytes: fixtureBytes('sample.docx') }, CTX)).toEqual({ canceled: true });
    const target = path.join(originals, 'Letter copy');
    s.pathQueue.push(target);
    const res = await s.documents.saveCopy({ documentId: document.id, bytes: fixtureBytes('sample.docx') }, CTX);
    expect(s.pathDialogs.at(-1)).toMatchObject({ kind: 'save', defaultName: 'Letter (copy).docx', filters: [{ name: 'Word document', extensions: ['docx'] }] });
    expect(fs.readFileSync(`${target}.docx`).equals(fixtureBytes('sample.docx'))).toBe(true);
    expect(res).toMatchObject({ canceled: false, document: { title: 'Letter (copy)', storage: 'linked', folderId: folder.id, kind: 'docx' } });
    s.pathQueue.push(path.join(originals, 'bad.docx'));
    expect((await rejection(s.documents.saveCopy({ documentId: document.id, bytes: Buffer.from('x') }, CTX))).code).toBe('VALIDATION_FAILED');
    expect(fs.existsSync(path.join(originals, 'bad.docx'))).toBe(false);
  });
});

describe('opening documents', () => {
  it('a linked original changed outside the app is indexed again; a missing or damaged one is reported', async () => {
    const { s, original, importFile, documentRow } = await setupDocuments();
    const file = original('Notes.csv', 'Name\nAlpha\n');
    const doc = await importFile(file, 'link');
    fs.writeFileSync(file, 'Name\nBravo\nCharlie\n');
    const opened = await s.documents.open(doc.id);
    expect(opened.document.revision).toBe(0);
    expect(documentRow(doc.id)!.body_text).toContain('Bravo');
    expect(opened.document.sizeBytes).toBe(fs.statSync(file).size);
    fs.writeFileSync(file, Buffer.from([0x41, 0, 0x42]));
    expect((await s.documents.open(doc.id)).file?.state).toBe('damaged');
    fs.rmSync(file);
    expect((await s.documents.open(doc.id)).file).toEqual({ path: file, state: 'missing', sizeBytes: null, modifiedAt: null });
    s.trash.trashDocument(doc.id);
    expect(await rejection(s.documents.open(doc.id))).toMatchObject({ code: 'NOT_FOUND', message: DOCUMENT_MESSAGES.inTrash });
  });

  it('hands Office, PDF and CSV files to the OS, never an HTML page; Show in folder shows the original', async () => {
    const { s, original, importFile, shellCalls } = await setupDocuments().then((d) => ({ ...d, shellCalls: d.s.shellCalls }));
    const pdf = await importFile(original('Paper.pdf'), 'link');
    expect(await s.documents.openExternal(pdf.id)).toEqual({ opened: true });
    expect(shellCalls.at(-1)).toEqual({ op: 'openPath', target: path.join(path.dirname(original('x.pdf')), 'Paper.pdf') });
    const page = await importFile(original('Page.html'), 'copy');
    expect(await rejection(s.documents.openExternal(page.id))).toMatchObject({ code: 'FORBIDDEN', message: DOCUMENT_MESSAGES.notOpenable });
    await s.documents.showInFolder(pdf.id);
    expect(shellCalls.at(-1)?.op).toBe('showItemInFolder');
    s.shellResult.error = 'no app';
    const sheet = await importFile(original('Sheet.xlsx'), 'copy');
    expect((await rejection(s.documents.openExternal(sheet.id))).code).toBe('UNSUPPORTED');
  });
});

describe('documents in the tree, Home, search and tabs', () => {
  it('rename, move, favorite and invariants', async () => {
    const { s } = await setupDocuments();
    const project = s.project('Alpha');
    const folder = s.folder(project.id, null, 'Specs');
    const { document } = await s.documents.createBlank('pptx', COMMON);
    expect(s.hierarchy.renameDocument(document.id, '  Launch deck ').document.title).toBe('Launch deck');
    expect((await rejection(Promise.resolve().then(() => s.hierarchy.renameDocument(document.id, '')))).code).toBe('VALIDATION_FAILED');
    expect(s.hierarchy.moveDocument(document.id, { projectId: project.id, folderId: folder.id }).document).toMatchObject({ projectId: project.id, folderId: folder.id });
    expect((await rejection(Promise.resolve().then(() => s.hierarchy.moveDocument(document.id, { projectId: null, folderId: folder.id })))).code).toBe('VALIDATION_FAILED');
    s.hierarchy.setFavorite('document', document.id, true);
    expect(s.hierarchy.list().documents[0]?.favorite).toBe(true);
    const other = s.project('Beta');
    s.hierarchy.moveFolder(folder.id, { projectId: other.id, parentId: null });
    expect(s.row('SELECT project_id FROM documents WHERE id = ?', document.id)).toEqual({ project_id: other.id });
    s.check();
  });

  it('search finds documents by title and text in scope, never in Trash, and a tag filter lists notes only', async () => {
    const { s, original, importFile } = await setupDocuments();
    const project = s.project('Alpha');
    const deck = await importFile(original('Launch.pptx'), 'copy', { projectId: project.id, folderId: null });
    await importFile(original('Budget.xlsx'), 'copy');
    const hit = s.search.query({ query: 'roadmap' });
    expect(hit.documents.map((r) => [r.document.id, r.document.path])).toEqual([[deck.id, ['Alpha']]]);
    expect(hit.documents[0]!.snippet.some((seg) => seg.hit && /roadmap/i.test(seg.text))).toBe(true);
    expect(s.search.query({ query: 'La' }).documents.map((r) => r.document.title)).toEqual(['Launch']);
    expect(s.search.query({ query: 'roadmap', scope: { kind: 'common' } }).documents).toEqual([]);
    expect(s.search.query({ query: 'receipts' }).documents.map((r) => r.document.title)).toEqual(['Budget']);
    expect(s.search.query({ query: 'roadmap', tags: ['work'] }).documents).toEqual([]);
    s.trash.trashDocument(deck.id);
    expect(s.search.query({ query: 'roadmap' }).documents).toEqual([]);
  });

  it('Home lists recent documents of the scope; the tab session drops trashed and missing documents', async () => {
    const { s } = await setupDocuments();
    const { document: a } = await s.documents.createBlank('docx', COMMON, 'First');
    s.tick();
    const { document: b } = await s.documents.createBlank('xlsx', COMMON, 'Second');
    expect(s.home.summary({ kind: 'all' }).recentDocuments.map((d) => d.title)).toEqual(['Second', 'First']);
    expect(s.home.summary({ kind: 'common' }).recentDocuments).toHaveLength(2);
    const tabs = [a.id, b.id, randomUUID()].map((id) => ({ id: `document:${id}`, kind: 'document' as const, documentId: id }));
    s.sessions.set({ version: 1, tabs: [{ id: 'home', kind: 'home' }, ...tabs], activeTabId: tabs[0]!.id });
    s.trash.trashDocument(a.id);
    expect(s.sessions.get()).toEqual({
      session: { version: 1, tabs: [{ id: 'home', kind: 'home' }, tabs[1]], activeTabId: 'home' },
      dropped: { trashed: 1, missing: 1, duplicates: 0 },
    });
  });
});

describe('documents in Trash', () => {
  it('trash, restore and purge alone or with their folder or project; purge leaves blobs to GC after the grace', async () => {
    const { s, documentRow, blobFile } = await setupDocuments();
    const project = s.project('Alpha');
    const folder = s.folder(project.id, null, 'Specs');
    const { document: inFolder } = await s.documents.createBlank('docx', { projectId: project.id, folderId: folder.id });
    const { document: alone } = await s.documents.createBlank('pptx', COMMON, 'Deck');
    const trashed = s.trash.trashDocument(alone.id);
    expect(trashed).toMatchObject({ counts: { projects: 0, folders: 0, notes: 0, documents: 1 }, trashedDocumentIds: [alone.id] });
    expect(s.events.at(-1)).toEqual({ reason: 'trash', trashedNoteIds: [], trashedDocumentIds: [alone.id] });
    expect(s.trash.list().items).toMatchObject([{ kind: 'document', id: alone.id, label: 'Deck', documentKind: 'pptx', contains: { folders: 0, notes: 0, documents: 0 }, fromPath: ['Common'] }]);
    expect(s.trash.restore(trashed.trashBatchId)).toMatchObject({ kind: 'document', id: alone.id, relocated: false, restoredDocumentIds: [alone.id] });

    const folderBatch = s.trash.trashFolder(folder.id);
    expect(folderBatch.trashedDocumentIds).toEqual([inFolder.id]);
    expect(s.trash.list().items[0]).toMatchObject({ kind: 'folder', contains: { documents: 1 } });
    s.trash.trashProject(project.id);
    s.check();
    const purged = s.trash.purge({ target: { kind: 'all' }, confirmed: true });
    expect(purged.purged).toEqual({ projects: 1, folders: 1, notes: 0, documents: 1 });
    expect(documentRow(inFolder.id)).toBeUndefined();
    const blob = documentRow(alone.id)!.blob_id!;
    expect(fs.existsSync(blobFile(blob))).toBe(true);

    // The pptx blob is still used; the purged docx's blob waits for the grace period.
    const docxBlob = s.row<{ id: string; relative_path: string }>("SELECT id, relative_path FROM document_blobs WHERE relative_path LIKE '%.docx'")!;
    s.clock.advance(ATTACHMENT_GC_GRACE_MS - 1000);
    expect((await s.maintenance.run()).documentBlobsDeleted).toBe(0);
    s.clock.advance(2000);
    expect((await s.maintenance.run()).documentBlobsDeleted).toBe(1);
    expect(fs.existsSync(path.join(s.dataDir, docxBlob.relative_path))).toBe(false);
    expect(fs.existsSync(blobFile(blob))).toBe(true);
  });

  it('a document trashed with a folder comes back to the Common root when the folder was purged', async () => {
    const { s } = await setupDocuments();
    const folder = s.folder(null, null, 'Old');
    const { document } = await s.documents.createBlank('docx', { projectId: null, folderId: folder.id });
    const docBatch = s.trash.trashDocument(document.id);
    const folderBatch = s.trash.trashFolder(folder.id);
    s.trash.purge({ target: { kind: 'batch', batchId: folderBatch.trashBatchId }, confirmed: true });
    expect(s.trash.restore(docBatch.trashBatchId)).toMatchObject({ kind: 'document', relocated: true, location: { projectId: null, folderId: null } });
    s.check();
  });

  it('versions keep their blobs alive until they are pruned', async () => {
    const { s } = await setupDocuments();
    const { document } = await s.documents.createBlank('docx', COMMON);
    await s.documents.save({ documentId: document.id, baseRevision: 0, bytes: fixtureBytes('sample.docx') });
    s.clock.advance(ATTACHMENT_GC_GRACE_MS * 2);
    expect((await s.maintenance.run()).documentBlobsDeleted).toBe(0);
    expect(s.rows('SELECT id FROM document_blobs')).toHaveLength(2);
  });
});
