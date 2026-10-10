import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKUP_DB_ENTRY, MANIFEST_ENTRY, parseBackupManifest } from '../../src/main/portability/backup-manifest';
import { openArchive, writeArchive } from '../../src/main/portability/zip-archive';
import { CTX, fixtureBytes, setupDocuments } from './document-helpers';
import { setupServices } from './hierarchy-helpers';
import { cleanProfile, restartWithRestore, tmpFile } from './portability-helpers';

const nextTask = () => new Promise((resolve) => setImmediate(resolve));

/** A notebook with a managed document in a project folder and a linked one at the Common root. */
async function notebookWithDocuments() {
  const d = await setupDocuments();
  const project = d.s.project('Alpha');
  const folder = d.s.folder(project.id, null, 'Specs');
  const managed = await d.importFile(d.original('Launch.pptx'), 'copy', { projectId: project.id, folderId: folder.id });
  d.s.hierarchy.setFavorite('document', managed.id, true);
  const linkedFile = d.original('Budget.xlsx');
  const linked = await d.importFile(linkedFile, 'link');
  return { ...d, project, folder, managed, linked, linkedFile };
}

describe('documents in backups (INF-PORT-01, D-118)', () => {
  it('a backup carries every document blob; restoring brings the documents and their bytes back', async () => {
    const a = await notebookWithDocuments();
    const file = tmpFile('docs.infinitybackup');
    a.s.pathQueue.push(file);
    await a.s.portability.createBackup(CTX);
    const archive = await openArchive(file);
    const manifest = parseBackupManifest(await archive.read(MANIFEST_ENTRY, 1 << 20));
    archive.close();
    const blob = a.s.row<{ id: string; relative_path: string }>('SELECT b.id, b.relative_path FROM document_blobs b JOIN documents d ON d.blob_id = b.id')!;
    expect(manifest.documents).toEqual([{ id: blob.id, path: blob.relative_path, sha256: expect.any(String), size: fixtureBytes('sample.pptx').length }]);
    expect([...archive.names].sort()).toEqual([BACKUP_DB_ENTRY, MANIFEST_ENTRY, blob.relative_path].sort());

    const b = await cleanProfile();
    b.pathQueue.push(file);
    await b.portability.prepareRestore(CTX);
    await b.portability.restore();
    await nextTask();
    const { restore, services: r } = await restartWithRestore(b);
    expect(restore?.status).toBe('restored');
    expect(r.hierarchy.list().documents.map((d) => d.title).sort()).toEqual(['Budget', 'Launch']);
    expect(fs.readFileSync(path.join(r.dataDir, blob.relative_path)).equals(fixtureBytes('sample.pptx'))).toBe(true);
    expect((await r.documents.open(a.linked.id)).file).toMatchObject({ path: a.linkedFile, state: 'available' });
    expect(fs.existsSync(path.join(r.dataDir, 'documents', 'tmp'))).toBe(true);
  });

  it('a backup whose document blob was tampered with is refused before anything changes', async () => {
    const a = await notebookWithDocuments();
    const blob = a.s.row<{ relative_path: string }>('SELECT relative_path FROM document_blobs')!;
    const file = tmpFile('tampered.infinitybackup');
    a.s.pathQueue.push(file);
    await a.s.portability.createBackup(CTX);
    // Rewrite the archive with other bytes under the blob's name (the manifest hash no longer matches).
    const archive = await openArchive(file);
    const entries = await Promise.all([...archive.names].map(async (name) => ({ name, data: await archive.read(name, 64 << 20) })));
    archive.close();
    await writeArchive(file, entries.map(({ name, data }) => ({ name, buffer: name === blob.relative_path ? fixtureBytes('sample.docx') : data, compress: false })));
    const b = await cleanProfile();
    b.pathQueue.push(file);
    await expect(b.portability.prepareRestore(CTX)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(b.hierarchy.list().documents).toEqual([]);
  });
});

describe('documents in portable exports (INF-PORT-04, D-118)', () => {
  it('managed documents travel with their bytes and linked ones as links; the import gives them new IDs', async () => {
    const a = await notebookWithDocuments();
    const exportFile = tmpFile('docs.infinityexport');
    a.s.pathQueue.push(exportFile);
    const exported = await a.s.portability.exportPortable(CTX);
    expect(exported).toMatchObject({ canceled: false, counts: { documents: 2 } });
    const archive = await openArchive(exportFile);
    expect([...archive.names].sort()).toEqual(['data.json', `documents/${a.managed.id}.pptx`]);
    archive.close();

    const b = await setupServices();
    b.pathQueue.push(exportFile);
    const imported = await b.portability.importPortable(CTX);
    expect(imported).toMatchObject({ canceled: false, counts: { projects: 1, folders: 1, documents: 2 } });
    const docs = b.hierarchy.list().documents;
    const launch = docs.find((d) => d.title === 'Launch')!;
    const budget = docs.find((d) => d.title === 'Budget')!;
    expect([launch.id, budget.id]).not.toContain(a.managed.id);
    expect(launch).toMatchObject({ storage: 'managed', favorite: true, kind: 'pptx' });
    const specs = b.hierarchy.list().folders.find((f) => f.name === 'Specs')!;
    expect(launch.folderId).toBe(specs.id);
    expect(budget.storage).toBe('linked');
    expect(budget.folderId).not.toBeNull(); // Common items arrive in the "Imported …" folder.
    expect(b.search.query({ query: 'roadmap' }).documents.map((r) => r.document.id)).toEqual([launch.id]);
    expect((await b.documents.open(budget.id)).file).toMatchObject({ path: a.linkedFile, state: 'available' });
    b.check();
  });

  it('a linked document whose link a new profile cannot use is left out', async () => {
    const a = await notebookWithDocuments();
    a.s.t.db.prepare("UPDATE linked_files SET path = '//server/share/Budget.xlsx'").run();
    const exportFile = tmpFile('docs.infinityexport');
    a.s.pathQueue.push(exportFile);
    await a.s.portability.exportPortable(CTX);
    const b = await setupServices();
    b.pathQueue.push(exportFile);
    const imported = await b.portability.importPortable(CTX);
    expect(imported).toMatchObject({ counts: { documents: 1 } });
    expect(b.hierarchy.list().documents.map((d) => d.title)).toEqual(['Launch']);
  });
});
