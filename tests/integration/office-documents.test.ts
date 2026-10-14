import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { DOCUMENT_MESSAGES } from '../../src/shared/documents/messages';
import { paragraph, saveDoc } from './portability-helpers';
import { COMMON, CTX, fixtureBytes, rejection, setupDocuments } from './document-helpers';
import { catalogueRouter } from './ipc-helpers';
import { setupServices } from './hierarchy-helpers';

const NOT_USED = () => {
  throw new Error('not used');
};
const APP: AppHandlerDeps = { getInfo: NOT_USED, getCapabilities: NOT_USED, shell: { openPath: async () => '', openExternal: async () => {}, showItemInFolder: () => {} }, dataDir: '/data', quit: () => {}, flushed: () => true };
const OFF = { code: 'FORBIDDEN', message: DOCUMENT_MESSAGES.officeOff };

/** Services with a Word document and a spreadsheet made while Office documents were on, which are then turned off. */
async function documentsThenOff() {
  const d = await setupDocuments();
  const word = await d.importFile(d.original('Plan.docx'), 'copy');
  const sheet = await d.importFile(d.original('Budget.xlsx'), 'copy');
  const pdf = await d.importFile(d.original('Paper.pdf'), 'copy');
  await d.s.documents.save({ documentId: word.id, baseRevision: 0, bytes: fixtureBytes('sample-rich.docx') });
  const { workbook } = await d.s.spreadsheets.read(sheet.id);
  d.s.settings.set('documents.office', false);
  return { ...d, word, sheet, pdf, workbook };
}

describe('Office documents setting (D-187)', () => {
  it('is off for a new database and for one from an earlier version (the key is new), and is a public setting', async () => {
    const s = await setupServices({ office: false });
    expect(s.settings.getInternal('documents.office')).toBe(false);
    expect(s.settings.get(['documents.office'])).toEqual({ 'documents.office': false });
    expect(s.row('SELECT key FROM settings WHERE key = ?', 'documents.office')).toBeUndefined();
    s.settings.set('documents.office', true);
    expect(s.settings.get(['documents.office'])).toEqual({ 'documents.office': true });
    expect(s.settingsEvents.at(-1)).toMatchObject({ key: 'documents.office', value: true });
  });

  it('while off, main refuses to create, edit, save, restore or copy Word, spreadsheet and PowerPoint documents', async () => {
    const { s, word, sheet, workbook } = await documentsThenOff();
    for (const kind of ['docx', 'xlsx', 'pptx'] as const) expect(await rejection(s.documents.createBlank(kind, COMMON)), kind).toMatchObject(OFF);
    expect(await rejection(s.documents.save({ documentId: word.id, baseRevision: 1, bytes: fixtureBytes('sample.docx') }))).toMatchObject(OFF);
    const [version] = s.documents.versionsOf(word.id).versions;
    expect(await rejection(s.documents.restoreVersion({ documentId: word.id, versionId: version!.id, baseRevision: 1 }))).toMatchObject(OFF);
    expect(await rejection(s.documents.copyVersion(word.id, version!.id))).toMatchObject(OFF);
    expect(await rejection(s.documents.saveCopy({ documentId: word.id, bytes: fixtureBytes('sample.docx') }, CTX))).toMatchObject(OFF);
    expect(await rejection(s.spreadsheets.read(sheet.id))).toMatchObject(OFF);
    expect(await rejection(s.spreadsheets.save({ documentId: sheet.id, baseRevision: 0, workbook }))).toMatchObject(OFF);
    expect(s.row<{ revision: number }>('SELECT revision FROM documents WHERE id = ?', word.id)?.revision).toBe(1);
  });

  it('keeps every existing document: it opens, opens in the system app, exports, is found, trashed and restored', async () => {
    const { s, word, original } = await documentsThenOff();
    expect((await s.documents.open(word.id)).document).toMatchObject({ id: word.id, kind: 'docx', revision: 1 });
    await s.documents.openExternal(word.id);
    expect(s.shellCalls.at(-1)).toMatchObject({ op: 'openPath' });
    const target = path.join(path.dirname(original('x.txt', 'x')), 'Plan copy.docx');
    s.pathQueue.push(target);
    expect(await s.documents.exportCopy({ documentId: word.id }, CTX)).toEqual({ canceled: false });
    expect(s.search.query({ query: 'Plan' }).documents.map((d) => d.document.id)).toContain(word.id);
    s.trash.trashDocument(word.id);
    const batch = s.row<{ trash_batch_id: string }>('SELECT trash_batch_id FROM documents WHERE id = ?', word.id)!.trash_batch_id;
    s.trash.restore(batch);
    expect(s.row('SELECT deleted_at FROM documents WHERE id = ?', word.id)).toEqual({ deleted_at: null });
  });

  it('while off, Import file offers PDF and web pages only and refuses Office files by name, also when added later', async () => {
    const d = await setupDocuments({ office: false });
    d.s.dialogQueue.push([d.original('Plan.docx'), d.original('Budget.csv', 'a,b\n1,2\n'), d.original('Paper.pdf')]);
    const pick = await d.s.documents.pickFiles(CTX);
    expect(d.s.dialogCalls.at(-1)?.filter?.extensions).toEqual(['pdf', 'html', 'htm']);
    expect(pick.files.map((f) => f.name)).toEqual(['Paper.pdf']);
    expect(pick.rejected.map((r) => [r.name, r.code, r.message])).toEqual([
      ['Plan.docx', 'UNSUPPORTED', DOCUMENT_MESSAGES.officeOffImport],
      ['Budget.csv', 'UNSUPPORTED', DOCUMENT_MESSAGES.officeOffImport],
    ]);
    // A pick made while the setting was on is checked again when it is added.
    d.s.settings.set('documents.office', true);
    d.s.dialogQueue.push([d.original('Deck.pptx')]);
    const earlier = await d.s.documents.pickFiles(CTX);
    d.s.settings.set('documents.office', false);
    expect(await rejection(d.s.documents.addPicked({ pickId: earlier.pickId!, index: 0, action: 'copy', location: COMMON }, CTX))).toMatchObject({
      code: 'FORBIDDEN',
      message: DOCUMENT_MESSAGES.officeOffImport,
    });
    expect(d.s.rows('SELECT id FROM documents')).toEqual([]);
  });

  it('while off, a note’s attached or linked Office file stays a file: "Open in Infinity Notes" is refused', async () => {
    const d = await setupDocuments({ office: false });
    const note = d.s.note(null, null, 'Minutes');
    const { attachment } = await d.s.attachments.importBytes({ kind: 'document', originalName: 'Minutes.xlsx', bytes: fixtureBytes('sample.xlsx') });
    const link = await d.s.links.create(d.original('Deck.pptx'));
    saveDoc(d.s, note.id, {
      type: 'doc',
      content: [
        paragraph(randomUUID(), 'See'),
        { type: 'fileAttachment', attrs: { id: randomUUID(), attachmentId: attachment.id, name: 'Minutes.xlsx', sizeBytes: attachment.sizeBytes, mime: attachment.mime } },
        { type: 'fileLink', attrs: { id: randomUUID(), linkId: link.id, name: 'Deck.pptx', sizeBytes: link.sizeBytes } },
      ],
    });
    expect(await rejection(d.s.documents.fromAttachment(note.id, attachment.id))).toMatchObject(OFF);
    expect(await rejection(d.s.documents.fromLink(note.id, link.id))).toMatchObject(OFF);
    expect(d.s.rows('SELECT id FROM documents')).toEqual([]);
    // The file itself opens in the system app as before.
    await d.s.handoff.open(note.id, attachment.id);
    expect(d.s.shellCalls.at(-1)).toMatchObject({ op: 'openPath' });
  });

  it('PDF documents work as before while Office documents are off', async () => {
    const { s, pdf } = await documentsThenOff();
    const saved = await s.documents.save({ documentId: pdf.id, baseRevision: 0, bytes: fixtureBytes('sample-pages.pdf') });
    expect(saved.document.revision).toBe(1);
  });

  it('the refusal reaches the window as FORBIDDEN through the router', async () => {
    const { s } = await documentsThenOff();
    const r = catalogueRouter(s.services, APP);
    expect(await r.call('document:create', { location: COMMON, kind: 'pptx' })).toEqual({ ok: false, error: OFF });
  });
});
