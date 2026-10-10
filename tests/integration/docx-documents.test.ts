import fs from 'node:fs';
import { exportDocx, importDocx } from '@portone/docx-editor/core';
import { EditorState } from '@tiptap/pm/state';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_MESSAGES } from '../../src/shared/documents/messages';
import { fixtureBytes, rejection, setupDocuments } from './document-helpers';

/** The editor reads OOXML with the browser's XML parser; under Node the test hands it jsdom's (D-142). */
const xmlParser = new new JSDOM('').window.DOMParser();

/** What the Word editor in the renderer does on Save: the edited document written into the package it opened. */
function editAndExport(bytes: Uint8Array, text: string): Uint8Array {
  const { doc, session } = importDocx(bytes, { xmlParser });
  const state = EditorState.create({ doc });
  const edited = state.apply(state.tr.insertText(text, 1)).doc;
  return exportDocx(edited, session, { xmlParser });
}

const parts = (bytes: Uint8Array) => unzipSync(bytes);
const firstParagraph = (bytes: Uint8Array) => importDocx(bytes, { xmlParser }).doc.child(0).textContent;

describe('Word documents saved from the editor (F4, D-142)', () => {
  it('an untouched export keeps every part byte for byte', () => {
    const original = new Uint8Array(fixtureBytes('sample-rich.docx'));
    const { doc, session } = importDocx(original, { xmlParser });
    const before = parts(original);
    const after = parts(exportDocx(doc, session, { xmlParser }));
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const name of Object.keys(before)) expect(Buffer.from(after[name]!).equals(Buffer.from(before[name]!)), name).toBe(true);
  });

  it('saving an edit changes only the body part; headings, lists, table, picture, header, footer, notes and comments stay', async () => {
    const { s, importFile, original } = await setupDocuments();
    const doc = await importFile(original('Handbook.docx', fixtureBytes('sample-rich.docx')), 'copy');
    const opened = new Uint8Array(fixtureBytes('sample-rich.docx'));
    const saved = await s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: editAndExport(opened, 'Edited ') });
    expect(saved.document.revision).toBe(1);

    const stored = new Uint8Array(fs.readFileSync((await s.documents.fileOf(doc.id)).file));
    const before = parts(opened);
    const after = parts(stored);
    const changed = Object.keys(before).filter((name) => !Buffer.from(after[name]!).equals(Buffer.from(before[name]!)));
    expect(changed).toEqual(['word/document.xml']);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    // Reopening shows the edit, and the rest of the body is as it was.
    const reopened = importDocx(stored, { xmlParser }).doc;
    expect(reopened.child(0).textContent).toBe('Edited Project handbook');
    expect(reopened.textContent).toContain('Draft agenda');
    let images = 0;
    reopened.descendants((node) => void (node.type.name === 'image' && (images += 1)));
    expect(images).toBe(1);
  });

  it('keeps the replaced revision as a version, reads it back, restores it, and searches the saved text', async () => {
    const { s, importFile, original, documentRow } = await setupDocuments();
    const doc = await importFile(original('Handbook.docx', fixtureBytes('sample-rich.docx')), 'copy');
    const first = new Uint8Array(fixtureBytes('sample-rich.docx'));
    await s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: editAndExport(first, 'Zephyrine ') });
    expect(documentRow(doc.id)!.body_text).toContain('Zephyrine Project handbook');
    expect(s.search.query({ query: 'zephyrine' }).documents.map((r) => r.document.title)).toEqual(['Handbook']);

    const [version] = s.documents.versionsOf(doc.id).versions;
    expect(version).toMatchObject({ revision: 0, reason: 'save' });
    const old = new Uint8Array(fs.readFileSync((await s.documents.fileOf(doc.id, version!.id)).file));
    expect(firstParagraph(old)).toBe('Project handbook');

    await s.documents.restoreVersion({ documentId: doc.id, versionId: version!.id, baseRevision: 1 });
    const current = new Uint8Array(fs.readFileSync((await s.documents.fileOf(doc.id)).file));
    expect(firstParagraph(current)).toBe('Project handbook');
    expect(s.search.query({ query: 'zephyrine' }).documents).toEqual([]);
    expect(s.documents.versionsOf(doc.id).versions.map((v) => [v.revision, v.reason])).toEqual([
      [1, 'restore'],
      [0, 'save'],
    ]);
  });

  it('a linked Word document is saved back to its original in place', async () => {
    const { s, importFile, original } = await setupDocuments();
    const file = original('Linked.docx', fixtureBytes('sample-rich.docx'));
    const doc = await importFile(file, 'link');
    const opened = await s.documents.open(doc.id);
    const bytes = editAndExport(new Uint8Array(fs.readFileSync(file)), 'Linked edit ');
    await s.documents.save({ documentId: doc.id, baseRevision: 0, bytes, expectedFile: { sizeBytes: opened.file!.sizeBytes!, modifiedAt: opened.file!.modifiedAt! } });
    expect(firstParagraph(new Uint8Array(fs.readFileSync(file)))).toBe('Linked edit Project handbook');
  });

  it('refuses bytes that are not a Word document, or that carry macros, before anything is replaced (D-143)', async () => {
    const { s, importFile, original } = await setupDocuments();
    const doc = await importFile(original('Handbook.docx', fixtureBytes('sample-rich.docx')), 'copy');
    const notWord = await rejection(s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: new Uint8Array(fixtureBytes('sample.xlsx')) }));
    expect(notWord).toMatchObject({ code: 'VALIDATION_FAILED', message: DOCUMENT_MESSAGES.damaged('docx') });
    const package_ = parts(new Uint8Array(fixtureBytes('sample-rich.docx')));
    const types = new TextDecoder().decode(package_['[Content_Types].xml']).replace(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      'application/vnd.ms-word.document.macroEnabled.main+xml',
    );
    const macro = zipSync({ ...package_, '[Content_Types].xml': strToU8(types) });
    expect(await rejection(s.documents.save({ documentId: doc.id, baseRevision: 0, bytes: macro }))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await s.documents.open(doc.id)).document.revision).toBe(0);
  });
});
