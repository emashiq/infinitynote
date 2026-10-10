import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { DOCUMENT_SAVE_MAX_PAYLOAD_BYTES } from '../../src/main/ipc/handlers/document-handlers';
import { DOCUMENT_MESSAGES } from '../../src/shared/documents/messages';
import { fixtureBytes, setupDocuments } from './document-helpers';
import { catalogueRouter } from './ipc-helpers';

const COMMON = { projectId: null, folderId: null };
const NOT_USED = () => {
  throw new Error('not used');
};

async function setup() {
  const d = await setupDocuments();
  const app: AppHandlerDeps = {
    getInfo: NOT_USED,
    getCapabilities: NOT_USED,
    shell: { openPath: async () => '', openExternal: async () => {}, showItemInFolder: () => {} },
    dataDir: '/data',
    quit: () => {},
    flushed: () => true,
  };
  const sticky = d.s.note(null, null, 'Sticky note', true);
  const r = catalogueRouter(d.s.services, app, { stickyNoteId: sticky.id });
  return { ...d, call: r.call, sticky };
}

describe('document channels (D-118)', () => {
  it('create, open, rename, move, favorite, save, versions and trash through the router, responses validated', async () => {
    const { call, s } = await setup();
    const created = await call('document:create', { location: COMMON, kind: 'docx', title: 'Plan' });
    expect(created).toMatchObject({ ok: true, data: { document: { title: 'Plan', kind: 'docx', storage: 'managed' } } });
    const documentId = created.data.document.id as string;
    expect(await call('document:open', { documentId })).toMatchObject({ ok: true, data: { file: null, document: { revision: 0 } } });
    expect(await call('document:rename', { documentId, title: 'Plan B' })).toMatchObject({ ok: true, data: { document: { title: 'Plan B' } } });
    const folder = s.folder(null, null, 'Docs');
    expect(await call('document:move', { documentId, target: { projectId: null, folderId: folder.id } })).toMatchObject({ ok: true, data: { document: { folderId: folder.id } } });
    expect(await call('item:setFavorite', { kind: 'document', id: documentId, favorite: true })).toEqual({ ok: true, data: { kind: 'document', id: documentId, favorite: true } });
    const saved = await call('document:save', { documentId, baseRevision: 0, bytes: new Uint8Array(fixtureBytes('sample.docx')) });
    expect(saved).toMatchObject({ ok: true, data: { document: { revision: 1 } } });
    const versions = await call('document:versions', { documentId });
    expect(versions.data.versions).toHaveLength(1);
    expect(await call('document:restoreVersion', { documentId, versionId: versions.data.versions[0].id, baseRevision: 1 })).toMatchObject({ ok: true, data: { document: { revision: 2 } } });
    expect(await call('document:trash', { documentId })).toMatchObject({ ok: true, data: { trashedDocumentIds: [documentId], counts: { documents: 1 } } });
    expect(await call('tree:list', {})).toMatchObject({ ok: true, data: { documents: [] } });
    expect(await call('document:open', { documentId })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', message: DOCUMENT_MESSAGES.inTrash } });
  });

  it('pick and add a file, and open a note attachment in the app', async () => {
    const { call, s, original } = await setup();
    s.dialogQueue.push([original('Paper.pdf')]);
    const pick = await call('document:pickFiles', {});
    expect(pick).toMatchObject({ ok: true, data: { canceled: false, files: [{ name: 'Paper.pdf' }] } });
    const added = await call('document:addPicked', { pickId: pick.data.pickId, index: 0, action: 'link', location: COMMON });
    expect(added).toMatchObject({ ok: true, data: { document: { storage: 'linked', kind: 'pdf' } } });
    expect(await call('document:fromAttachment', { noteId: randomUUID(), attachmentId: randomUUID() })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('refuses malformed requests before any handler runs', async () => {
    const { call, s } = await setup();
    const spy = vi.spyOn(s.documents, 'save');
    for (const [channel, payload] of [
      ['document:create', { location: COMMON, kind: 'pdf' }],
      ['document:create', { location: COMMON, kind: 'docx', title: '' }],
      ['document:open', { documentId: 'nope' }],
      ['document:save', { documentId: randomUUID(), baseRevision: 0, bytes: [1, 2] }],
      ['document:save', { documentId: randomUUID(), baseRevision: -1, bytes: new Uint8Array([1]) }],
      ['document:save', { documentId: randomUUID(), baseRevision: 0, bytes: new Uint8Array([1]), path: 'C:/x.docx' }],
      ['document:addPicked', { pickId: randomUUID(), index: 20, action: 'copy', location: COMMON }],
      ['document:addPicked', { pickId: randomUUID(), index: 0, action: 'move', location: COMMON }],
      ['document:rename', { documentId: randomUUID(), title: 'a\u0000b' }],
      ['document:createBeside', { documentId: randomUUID(), title: '', bytes: new Uint8Array([1]) }],
      ['document:createBeside', { documentId: randomUUID(), title: 'Pages', bytes: new Uint8Array(0) }],
      ['document:createBeside', { documentId: randomUUID(), title: 'Pages', bytes: new Uint8Array([1]), kind: 'docx' }],
      ['document:pickPdf', { path: 'C:/x.pdf' }],
    ] as const) {
      expect(await call(channel, payload), channel).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('a save payload is measured by its bytes; one over the ceiling never reaches the service', async () => {
    const { call, s } = await setup();
    const spy = vi.spyOn(s.documents, 'save');
    const tooBig = new Uint8Array(DOCUMENT_SAVE_MAX_PAYLOAD_BYTES);
    expect(await call('document:save', { documentId: randomUUID(), baseRevision: 0, bytes: tooBig })).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED', message: DOCUMENT_MESSAGES.tooLargeToSave(200) },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('PDF pages: pick a PDF in main and store extracted pages beside the document (D-131)', async () => {
    const { call, s, importFile, original } = await setup();
    const source = await importFile(original('Plan.pdf', fixtureBytes('sample-pages.pdf')), 'copy');
    s.pathQueue.push(original('Other.pdf', fixtureBytes('sample.pdf')));
    const picked = await call('document:pickPdf', {});
    expect(picked).toMatchObject({ ok: true, data: { canceled: false, name: 'Other.pdf' } });
    expect(Buffer.from(picked.data.bytes as Uint8Array).equals(fixtureBytes('sample.pdf'))).toBe(true);
    expect(await call('document:pickPdf', {})).toEqual({ ok: true, data: { canceled: true } });
    const beside = await call('document:createBeside', { documentId: source.id, title: 'Plan (page 1)', bytes: new Uint8Array(fixtureBytes('sample.pdf')) });
    expect(beside).toMatchObject({ ok: true, data: { document: { title: 'Plan (page 1)', kind: 'pdf', storage: 'managed', projectId: null, folderId: null } } });
  });

  it('spreadsheets: read the workbook, save an edited model, copy and export versions through the router (D-134, D-141)', async () => {
    const { call, s, importFile, original } = await setup();
    const doc = await importFile(original('Budget.xlsx'), 'copy');
    const read = await call('document:readWorkbook', { documentId: doc.id });
    expect(read).toMatchObject({ ok: true, data: { csv: null, simplified: [], workbook: { activeSheet: 0 } } });
    const workbook = read.data.workbook;
    workbook.sheets[0].cells.push({ r: 9, c: 0, v: 'added' });
    workbook.sheets[0].rowCount = 10;
    expect(await call('document:saveWorkbook', { documentId: doc.id, baseRevision: 0, workbook })).toMatchObject({ ok: true, data: { document: { revision: 1 } } });
    const versions = await call('document:versions', { documentId: doc.id });
    const versionId = versions.data.versions[0].id;
    expect(await call('document:readWorkbook', { documentId: doc.id, versionId })).toMatchObject({ ok: true });
    expect(await call('document:copyVersion', { documentId: doc.id, versionId })).toMatchObject({ ok: true, data: { document: { title: 'Budget (revision 0)', kind: 'xlsx' } } });
    expect(await call('document:export', { documentId: doc.id })).toEqual({ ok: true, data: { canceled: true } });
    expect(s.pathDialogs.at(-1)).toMatchObject({ kind: 'save', title: 'Export a copy' });
  });

  it('a workbook outside the model is refused before main writes anything', async () => {
    const { call, importFile, original } = await setup();
    const doc = await importFile(original('Budget.xlsx'), 'copy');
    const { data } = await call('document:readWorkbook', { documentId: doc.id });
    const outside = structuredClone(data.workbook);
    outside.sheets[0].cells.push({ r: outside.sheets[0].rowCount + 5, c: 0, v: 1 });
    expect(await call('document:saveWorkbook', { documentId: doc.id, baseRevision: 0, workbook: outside })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const twins = structuredClone(data.workbook);
    twins.sheets.push({ ...structuredClone(twins.sheets[0]), name: twins.sheets[0].name.toUpperCase() });
    expect(await call('document:saveWorkbook', { documentId: doc.id, baseRevision: 0, workbook: twins })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    const scripted = structuredClone(data.workbook);
    scripted.sheets[0].cells[0].onload = 'x';
    expect(await call('document:saveWorkbook', { documentId: doc.id, baseRevision: 0, workbook: scripted })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await call('document:readWorkbook', { documentId: doc.id, versionId: 'nope' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await call('document:open', { documentId: doc.id })).toMatchObject({ ok: true, data: { document: { revision: 0 } } });
  });

  it('documents are main-window only: a sticky window is refused every document channel', async () => {
    const { call, sticky } = await setup();
    for (const channel of [
      'document:create',
      'document:open',
      'document:save',
      'document:fromAttachment',
      'document:pickFiles',
      'document:pickPdf',
      'document:createBeside',
      'document:readWorkbook',
      'document:saveWorkbook',
      'document:copyVersion',
      'document:export',
    ]) {
      expect(await call(channel, { noteId: sticky.id, documentId: randomUUID() }, 3), channel).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    }
  });
});
