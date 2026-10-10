import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deletePages, extractPages } from '../../src/renderer/documents/pdf/pdf-pages';
import { DOCUMENT_MESSAGES } from '../../src/shared/documents/messages';
import { CTX, fixtureBytes, rejection, setupDocuments, type Services } from './document-helpers';

const MB = 1024 * 1024;
const pdfBytes = (name: string) => new Uint8Array(fixtureBytes(name));
const hits = (s: Services, query: string) => s.search.query({ query }).documents.map((r) => r.document.title);

describe('PDF text in search (D-129)', () => {
  it('an imported PDF is found by the text of its pages, read by the worker thread', async () => {
    const { s, importFile, original, documentRow } = await setupDocuments();
    const doc = await importFile(original('Plan.pdf', fixtureBytes('sample-pages.pdf')), 'copy');
    expect(documentRow(doc.id)!.body_text).toBe('Alpha page introduces the plan\n\nBravo page lists the details\n\nCharlie page closes the summary');
    expect(hits(s, 'bravo')).toEqual(['Plan']);
    const linked = await importFile(original('Shared.pdf', fixtureBytes('sample.pdf')), 'link');
    expect(documentRow(linked.id)!.body_text).toContain('Second page of the sample');
  });

  it('a password-protected or damaged PDF is indexed by its title only, and the log names no path', async () => {
    const { s, importFile, original, documentRow, originals } = await setupDocuments();
    const locked = await importFile(original('Secret.pdf', fixtureBytes('sample-protected.pdf')), 'copy');
    const broken = await importFile(original('Broken.pdf', fixtureBytes('sample-damaged.pdf')), 'copy');
    expect(documentRow(locked.id)!.body_text).toBe('');
    expect(documentRow(broken.id)!.body_text).toBe('');
    expect(hits(s, 'protected')).toEqual([]);
    expect(hits(s, 'Secret')).toEqual(['Secret']);
    const log = s.logger.lines.join('\n');
    expect(log).toContain('kind=pdf error=PasswordException');
    expect(log).toContain('kind=pdf error=InvalidPDFException');
    expect(log).not.toContain(originals);
  });
});

describe('saving PDFs (D-119, D-131)', () => {
  it('a page change saves as the next revision, keeps the old bytes as a version and re-indexes the text', async () => {
    const { s, importFile, original, documentRow } = await setupDocuments();
    const doc = await importFile(original('Plan.pdf', fixtureBytes('sample-pages.pdf')), 'copy');
    const edited = await deletePages(pdfBytes('sample-pages.pdf'), [1]);
    const saved = await s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: edited });
    expect(saved.document.revision).toBe(1);
    expect(documentRow(doc.id)!.body_text).not.toContain('Bravo');
    expect(hits(s, 'bravo')).toEqual([]);
    const { versions } = s.documents.versionsOf(doc.id);
    expect(versions.map((v) => [v.revision, v.reason])).toEqual([[0, 'save']]);
    const stale = await rejection(s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: edited }));
    expect(stale).toMatchObject({ code: 'CONFLICT', details: { reason: 'revision', currentRevision: 1 } });
    await s.documents.restoreVersion({ documentId: doc.id, versionId: versions[0]!.id, baseRevision: 1 });
    expect(hits(s, 'bravo')).toEqual(['Plan']);
  });

  it('refuses bytes that are not a PDF and leaves the document as it was', async () => {
    const { s, importFile, original, documentRow } = await setupDocuments();
    const doc = await importFile(original('Plan.pdf', fixtureBytes('sample-pages.pdf')), 'copy');
    const before = documentRow(doc.id);
    const refused = await rejection(s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: new Uint8Array(fixtureBytes('sample.docx')) }));
    expect(refused).toMatchObject({ code: 'VALIDATION_FAILED', message: DOCUMENT_MESSAGES.damaged('pdf') });
    expect(documentRow(doc.id)).toEqual(before);
  });

  it('a linked PDF saves back to its original file', async () => {
    const { s, importFile, original } = await setupDocuments();
    const file = original('Shared.pdf', fixtureBytes('sample-pages.pdf'));
    const doc = await importFile(file, 'link');
    const opened = await s.documents.open(doc.id);
    const edited = await deletePages(pdfBytes('sample-pages.pdf'), [0]);
    await s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: edited, expectedFile: { sizeBytes: opened.file!.sizeBytes!, modifiedAt: opened.file!.modifiedAt! } });
    expect(fs.readFileSync(file).equals(Buffer.from(edited))).toBe(true);
    expect(hits(s, 'alpha')).toEqual([]);
    expect(hits(s, 'charlie')).toEqual(['Shared']);
  });
});

describe('PDF page operations in main (D-131)', () => {
  it('createBeside stores extracted pages as a new PDF in the same folder', async () => {
    const { s, importFile, original, documentRow } = await setupDocuments();
    const project = s.project('Alpha');
    const folder = s.folder(project.id, null, 'Specs');
    const source = await importFile(original('Plan.pdf', fixtureBytes('sample-pages.pdf')), 'copy', { projectId: project.id, folderId: folder.id });
    const extracted = await extractPages(pdfBytes('sample-pages.pdf'), [2]);
    const { document } = await s.documents.createBeside(source.id, 'Plan (page 3)', extracted);
    expect(document).toMatchObject({ title: 'Plan (page 3)', kind: 'pdf', storage: 'managed', projectId: project.id, folderId: folder.id, revision: 0 });
    expect(documentRow(document.id)!.body_text).toBe('Charlie page closes the summary');
    expect(s.events.at(-1)).toMatchObject({ reason: 'create' });
  });

  it('createBeside refuses other bytes, oversized bytes and a document in Trash', async () => {
    const { s, importFile, original } = await setupDocuments();
    const source = await importFile(original('Plan.pdf', fixtureBytes('sample-pages.pdf')), 'copy');
    expect(await rejection(s.documents.createBeside(source.id, 'X', new Uint8Array(fixtureBytes('sample.csv'))))).toMatchObject({ code: 'VALIDATION_FAILED' });
    const huge = new Uint8Array(26 * MB);
    huge.set(new TextEncoder().encode('%PDF-1.7\n'));
    expect(await rejection(s.documents.createBeside(source.id, 'X', huge))).toMatchObject({ code: 'LIMIT_EXCEEDED' });
    s.trash.trashDocument(source.id);
    expect(await rejection(s.documents.createBeside(source.id, 'X', pdfBytes('sample.pdf')))).toMatchObject({ code: 'NOT_FOUND' });
    expect(s.rows("SELECT id FROM documents WHERE title = 'X'")).toEqual([]);
  });

  it('pickPdf offers PDFs only, and checks the picked file before reading it', async () => {
    const { s, original, originals } = await setupDocuments();
    s.pathQueue.push(original('Other.pdf', fixtureBytes('sample.pdf')));
    const picked = await s.documents.pickPdf(CTX);
    expect(picked).toMatchObject({ canceled: false, name: 'Other.pdf' });
    expect(Buffer.from((picked as { bytes: Uint8Array }).bytes).equals(fixtureBytes('sample.pdf'))).toBe(true);
    expect(s.pathDialogs.at(-1)).toMatchObject({ kind: 'open', filters: [{ extensions: ['pdf'] }] });
    s.pathQueue.push(original('Fake.pdf', fixtureBytes('sample.docx')));
    expect(await rejection(s.documents.pickPdf(CTX))).toMatchObject({ code: 'VALIDATION_FAILED', message: DOCUMENT_MESSAGES.damaged('pdf') });
    const big = path.join(originals, 'Big.pdf');
    fs.writeFileSync(big, '%PDF-1.7\n');
    fs.truncateSync(big, 26 * MB);
    s.pathQueue.push(big);
    expect(await rejection(s.documents.pickPdf(CTX))).toMatchObject({ code: 'LIMIT_EXCEEDED', message: DOCUMENT_MESSAGES.tooLargeToInsert(25) });
    s.pathQueue.push(path.join(originals, 'missing.pdf'));
    expect(await rejection(s.documents.pickPdf(CTX))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await s.documents.pickPdf(CTX)).toEqual({ canceled: true });
  });
});
