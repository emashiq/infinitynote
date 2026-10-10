import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import yazl from 'yazl';
import { describe, expect, it } from 'vitest';
import { documentVersionUrl } from '../../src/shared/app-identity';
import { DOCUMENT_MESSAGES } from '../../src/shared/documents/messages';
import { WORKBOOK_MESSAGES } from '../../src/shared/documents/workbook-messages';
import type { WorkbookType } from '../../src/shared/documents/workbook';
import { createDocumentHandler } from '../../src/main/windows/document-protocol';
import { CTX, fixtureBytes, rejection, setupDocuments } from './document-helpers';
import { mkTmp } from './helpers';

/** A workbook with what F3 keeps (formulas, styles, a merge) and what it does not (a list rule, a named range). */
async function sampleWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Budget');
  ws.getCell('A1').value = 'Coffee';
  ws.getCell('B1').value = 12.5;
  ws.getCell('B2').value = 4;
  ws.getCell('B3').value = { formula: 'SUM(B1:B2)', result: 16.5 };
  ws.getCell('A1').font = { bold: true, color: { argb: 'FFC00000' } };
  ws.mergeCells('C1:D1');
  ws.getCell('A2').dataValidation = { type: 'list', allowBlank: true, formulae: ['"a,b"'] };
  wb.definedNames.add('Budget!$B$3', 'Total');
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const edit = (workbook: WorkbookType, value: string): WorkbookType => {
  const copy = structuredClone(workbook);
  copy.sheets[0]!.cells.push({ r: 5, c: 0, v: value });
  copy.sheets[0]!.rowCount = Math.max(copy.sheets[0]!.rowCount, 6);
  return copy;
};

describe('spreadsheet documents in main (D-134)', () => {
  it('reads an imported workbook into the model and lists what saving would not keep', async () => {
    const { s, importFile, original } = await setupDocuments();
    const doc = await importFile(original('Budget.xlsx', await sampleWorkbook()), 'copy');
    const read = await s.spreadsheets.read(doc.id);
    expect(read.csv).toBeNull();
    expect(read.simplified).toEqual(['dataValidation', 'namedRanges']);
    const cells = read.workbook.sheets[0]!.cells;
    expect(cells.find((c) => c.r === 2 && c.c === 1)).toMatchObject({ f: 'SUM(B1:B2)', v: 16.5 });
    expect(read.workbook.sheets[0]!.merges).toEqual([{ r: 0, c: 2, rows: 1, cols: 2 }]);
  });

  it('saves an edited workbook as the next revision: xlsx bytes, a version, new search text, and nothing simplified any more', async () => {
    const { s, importFile, original, documentRow } = await setupDocuments();
    const doc = await importFile(original('Budget.xlsx', await sampleWorkbook()), 'copy');
    const read = await s.spreadsheets.read(doc.id);
    const saved = await s.spreadsheets.save({ documentId: doc.id, baseRevision: 0, workbook: edit(read.workbook, 'Receipts kept') });
    expect(saved.document.revision).toBe(1);
    expect(s.documents.versionsOf(doc.id).versions.map((v) => v.revision)).toEqual([0]);
    expect(documentRow(doc.id)!.body_text).toContain('Receipts kept');
    expect(s.search.query({ query: 'receipts' }).documents.map((r) => r.document.title)).toEqual(['Budget']);
    const again = await s.spreadsheets.read(doc.id);
    expect(again.simplified).toEqual([]);
    expect(again.workbook.sheets[0]!.cells.find((c) => c.r === 5)?.v).toBe('Receipts kept');
    // A stale revision is a conflict and writes nothing.
    const stale = await rejection(s.spreadsheets.save({ documentId: doc.id, baseRevision: 0, workbook: read.workbook }));
    expect(stale).toMatchObject({ code: 'CONFLICT', details: { reason: 'revision', currentRevision: 1 } });
  });

  it('reads a version, restores it, and copies it as a new document', async () => {
    const { s, importFile, original } = await setupDocuments();
    const doc = await importFile(original('Budget.xlsx', await sampleWorkbook()), 'copy');
    const first = await s.spreadsheets.read(doc.id);
    await s.spreadsheets.save({ documentId: doc.id, baseRevision: 0, workbook: edit(first.workbook, 'second') });
    const [version] = s.documents.versionsOf(doc.id).versions;
    const old = await s.spreadsheets.read(doc.id, version!.id);
    expect(old.workbook.sheets[0]!.cells.some((c) => c.v === 'second')).toBe(false);
    expect(old.simplified).toEqual(['dataValidation', 'namedRanges']);
    const copy = await s.documents.copyVersion(doc.id, version!.id);
    expect(copy.document).toMatchObject({ title: 'Budget (revision 0)', kind: 'xlsx', storage: 'managed' });
    await s.documents.restoreVersion({ documentId: doc.id, versionId: version!.id, baseRevision: 1 });
    expect((await s.spreadsheets.read(doc.id)).workbook.sheets[0]!.cells.some((c) => c.v === 'second')).toBe(false);
    expect(await rejection(s.spreadsheets.read(doc.id, '00000000-0000-4000-8000-000000000000'))).toMatchObject({ code: 'NOT_FOUND', message: DOCUMENT_MESSAGES.versionMissing });
  });

  it('a CSV keeps its separator, encoding and byte-order mark when saved, also as a linked file', async () => {
    const { s, importFile, original } = await setupDocuments();
    const text = 'name;amount\r\nTea;4\r\n';
    const file = original('Prices.csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]));
    const doc = await importFile(file, 'link');
    const read = await s.spreadsheets.read(doc.id);
    expect(read.csv).toEqual({ delimiter: ';', encoding: 'utf-8', bom: true, lineEnding: '\r\n', finalNewline: true });
    const opened = await s.documents.open(doc.id);
    const expectedFile = { sizeBytes: opened.file!.sizeBytes!, modifiedAt: opened.file!.modifiedAt! };
    expect(await rejection(s.spreadsheets.save({ documentId: doc.id, baseRevision: 0, workbook: read.workbook, expectedFile }))).toMatchObject({ code: 'VALIDATION_FAILED' });
    await s.spreadsheets.save({ documentId: doc.id, baseRevision: 0, workbook: edit(read.workbook, 'Coffee'), csv: read.csv!, expectedFile });
    expect(fs.readFileSync(file)).toEqual(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('name;amount\r\nTea;4\r\n;\r\n;\r\n;\r\nCoffee;\r\n')]));
  });

  it('refuses files it cannot edit: too large, macro-enabled, damaged, or another kind', async () => {
    const { s, importFile, original } = await setupDocuments();
    const pdf = await importFile(original('Paper.pdf', fixtureBytes('sample.pdf')), 'copy');
    expect(await rejection(s.spreadsheets.read(pdf.id))).toMatchObject({ code: 'UNSUPPORTED' });
    const big = original('Big.csv', Buffer.alloc(26 * 1024 * 1024, 0x61));
    const linkedBig = await importFile(big, 'link');
    expect(await rejection(s.spreadsheets.read(linkedBig.id))).toMatchObject({ code: 'LIMIT_EXCEEDED', message: WORKBOOK_MESSAGES.tooLargeFile });
    const xlsx = original('Book.xlsx', await sampleWorkbook());
    const linked = await importFile(xlsx, 'link');
    // The original turns into a macro-enabled workbook outside the app.
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('<Types/>'), '[Content_Types].xml');
    zip.addBuffer(Buffer.from('<workbook/>'), 'xl/workbook.xml');
    zip.addBuffer(Buffer.from('VBA'), 'xl/vbaProject.bin');
    zip.end();
    const chunks: Buffer[] = [];
    for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
    fs.writeFileSync(xlsx, Buffer.concat(chunks));
    expect(await rejection(s.spreadsheets.read(linked.id))).toMatchObject({ code: 'VALIDATION_FAILED', message: WORKBOOK_MESSAGES.unreadable });
  });

  it('exports a copy of the saved bytes or a version through the save dialog, never over the original', async () => {
    const { s, importFile, original } = await setupDocuments();
    const doc = await importFile(original('Budget.xlsx', await sampleWorkbook()), 'copy');
    const read = await s.spreadsheets.read(doc.id);
    await s.spreadsheets.save({ documentId: doc.id, baseRevision: 0, workbook: edit(read.workbook, 'after') });
    const out = fs.realpathSync.native(mkTmp('infinity-export-'));
    s.pathQueue.push(path.join(out, 'Current'));
    expect(await s.documents.exportCopy({ documentId: doc.id }, CTX)).toEqual({ canceled: false });
    const [version] = s.documents.versionsOf(doc.id).versions;
    s.pathQueue.push(path.join(out, 'Old.xlsx'));
    await s.documents.exportCopy({ documentId: doc.id, versionId: version!.id }, CTX);
    const current = new ExcelJS.Workbook();
    await current.xlsx.readFile(path.join(out, 'Current.xlsx'));
    expect(current.getWorksheet('Budget')!.getCell('A6').value).toBe('after');
    const old = new ExcelJS.Workbook();
    await old.xlsx.readFile(path.join(out, 'Old.xlsx'));
    expect(old.getWorksheet('Budget')!.getCell('A6').value).toBeNull();
    expect(s.pathDialogs.at(-1)).toMatchObject({ kind: 'save', title: 'Export a copy', defaultName: 'Budget.xlsx' });
    // Canceling writes nothing; a linked original is never the target.
    expect(await s.documents.exportCopy({ documentId: doc.id }, CTX)).toEqual({ canceled: true });
    const linkedFile = original('Linked.xlsx', await sampleWorkbook());
    const linked = await importFile(linkedFile, 'link');
    s.pathQueue.push(linkedFile);
    expect(await rejection(s.documents.exportCopy({ documentId: linked.id }, CTX))).toMatchObject({ message: DOCUMENT_MESSAGES.exportOverOriginal });
  });

  it('serves a version’s bytes on the document protocol, and nothing for an unknown or malformed version', async () => {
    const { s, importFile, original } = await setupDocuments();
    const doc = await importFile(original('Budget.xlsx', await sampleWorkbook()), 'copy');
    const read = await s.spreadsheets.read(doc.id);
    await s.spreadsheets.save({ documentId: doc.id, baseRevision: 0, workbook: edit(read.workbook, 'x') });
    const [version] = s.documents.versionsOf(doc.id).versions;
    const handler = createDocumentHandler({ files: s.documentFiles, allowedOrigins: [] });
    const res = await handler(new Request(documentVersionUrl(doc.id, version!.id)));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).byteLength).toBe(version!.sizeBytes);
    expect((await handler(new Request(documentVersionUrl(doc.id, '00000000-0000-4000-8000-000000000000')))).status).toBe(404);
    expect((await handler(new Request(`infinity-document://${doc.id}/?version=..%2F..`))).status).toBe(404);
    await s.trash.trashDocument(doc.id);
    expect((await handler(new Request(documentVersionUrl(doc.id, version!.id)))).status).toBe(404);
  });
});
