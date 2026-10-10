import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RichDocLike } from '../../src/shared/editor/doc-schema';
import type { DocumentTargetType } from '../../src/shared/documents/targets';
import { COMMON } from './document-helpers';
import { setupServices, type Services } from './hierarchy-helpers';
import { richToMarkdown } from '../../src/main/portability/markdown';

const P = randomUUID();
const P2 = randomUUID();

/** A paragraph with text and a link to a document (and optionally a place in it). */
const linkPara = (id: string, text: string, documentId: string, target: DocumentTargetType | null = null, label = 'label') => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text }, { type: 'docRef', attrs: { documentId, target, label, alias: null } }],
});

function save(s: Services, noteId: string, content: RichDocLike) {
  const revision = s.row<{ revision: number }>('SELECT revision FROM notes WHERE id = ?', noteId)!.revision;
  return s.writer.save({ noteId, viewId: randomUUID(), baseRevision: revision, requestId: randomUUID(), format: 'rich', content });
}

async function setup() {
  const s = await setupServices();
  const { document } = await s.documents.createBlank('pptx', COMMON, 'Roadmap deck');
  const source = s.note(null, null, 'Planning');
  return { s, document, source };
}

describe('migration 012 document references (D-156)', () => {
  it('creates the table with its checks, cascades with the source note and keeps one row per block and place', async () => {
    const { s, document, source } = await setup();
    const insert = (target: string) =>
      s.t.db
        .prepare("INSERT INTO document_references(source_note_id, source_block_id, target_document_id, target_json, target_title_snapshot) VALUES (?, NULL, ?, ?, 'x')")
        .run(source.id, document.id, target);
    insert('');
    expect(() => insert('')).toThrow(/UNIQUE/);
    expect(() => insert('x'.repeat(1001))).toThrow(/CHECK/);
    expect(() => s.t.db.prepare("INSERT INTO document_references(source_note_id, target_document_id) VALUES (?, 'short')").run(source.id)).toThrow(/CHECK/);
    s.t.db.prepare('DELETE FROM notes WHERE id = ?').run(source.id);
    expect(s.rows('SELECT * FROM document_references')).toEqual([]);
  });
});

describe('links from notes to documents (F9, D-156)', () => {
  it('a document link is indexed with the save and listed as outgoing and as the document backlink, with its place', async () => {
    const { s, document, source } = await setup();
    save(s, source.id, { type: 'doc', content: [linkPara(P, 'See ', document.id, { slide: 3 }, 'Roadmap deck'), linkPara(P2, 'All of ', document.id, null, 'Roadmap deck')] });

    expect(s.references.list(source.id).documents).toEqual([
      { targetDocumentId: document.id, target: { slide: 3 }, title: 'Roadmap deck', kind: 'pptx', path: ['Common'], state: 'ok', trashBatchId: null },
      { targetDocumentId: document.id, target: null, title: 'Roadmap deck', kind: 'pptx', path: ['Common'], state: 'ok', trashBatchId: null },
    ]);
    expect(s.references.documentBacklinks(document.id).backlinks).toEqual([
      { sourceNoteId: source.id, sourceBlockId: P, target: { slide: 3 }, title: 'Planning', path: ['Common'], context: 'See Roadmap deck' },
      { sourceNoteId: source.id, sourceBlockId: P2, target: null, title: 'Planning', path: ['Common'], context: 'All of Roadmap deck' },
    ]);
    // The link reads as its label in search text.
    expect(s.row<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', source.id)!.plain_text).toBe('See Roadmap deck\nAll of Roadmap deck');
    // Removing the link removes the row in the same save.
    save(s, source.id, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: P }, content: [{ type: 'text', text: 'gone' }] }] });
    expect(s.references.documentBacklinks(document.id).backlinks).toEqual([]);
  });

  it('rename and move keep the link and show the new title and path; a trashed source drops out of the backlinks', async () => {
    const { s, document, source } = await setup();
    save(s, source.id, { type: 'doc', content: [linkPara(P, 'See ', document.id)] });
    const project = s.project('Atlas');
    s.hierarchy.renameDocument(document.id, 'Roadmap 2027');
    s.hierarchy.moveDocument(document.id, { projectId: project.id, folderId: null });
    expect(s.references.list(source.id).documents[0]).toMatchObject({ title: 'Roadmap 2027', path: ['Atlas'], state: 'ok' });

    const { trashBatchId } = s.trash.trashNote(source.id);
    expect(s.references.documentBacklinks(document.id).backlinks).toEqual([]);
    s.trash.restore(trashBatchId);
    expect(s.references.documentBacklinks(document.id).backlinks.map((b) => b.sourceNoteId)).toEqual([source.id]);
  });

  it('a trashed document shows Trash with its batch and comes back on restore; a purged one keeps its last title', async () => {
    const { s, document, source } = await setup();
    save(s, source.id, { type: 'doc', content: [linkPara(P, 'See ', document.id, { slide: 1 }, 'old label')] });
    const { trashBatchId } = s.trash.trashDocument(document.id);
    expect(s.references.list(source.id).documents[0]).toMatchObject({ state: 'trashed', trashBatchId, title: 'Roadmap deck', path: [] });
    s.trash.restore(trashBatchId);
    expect(s.references.list(source.id).documents[0]).toMatchObject({ state: 'ok', trashBatchId: null });

    const again = s.trash.trashDocument(document.id).trashBatchId;
    s.trash.purge({ target: { kind: 'batch', batchId: again }, confirmed: true });
    expect(s.references.list(source.id).documents).toEqual([
      { targetDocumentId: document.id, target: { slide: 1 }, title: 'Roadmap deck', kind: null, path: [], state: 'missing', trashBatchId: null },
    ]);
  });

  it('a link to a document that never existed is kept and shows as missing with its label', async () => {
    const { s, source } = await setup();
    const unknown = randomUUID();
    save(s, source.id, { type: 'doc', content: [linkPara(P, 'See ', unknown, null, 'Imported deck')] });
    expect(s.references.list(source.id).documents).toEqual([
      { targetDocumentId: unknown, target: null, title: 'Imported deck', kind: null, path: [], state: 'missing', trashBatchId: null },
    ]);
  });

  it('the link search ranks notes and documents together by title and leaves trashed items out', async () => {
    const { s, document } = await setup();
    s.note(null, null, 'Road trip');
    const trashed = s.note(null, null, 'Roadmap notes');
    s.trash.trashNote(trashed.id);
    const items = s.palette.searchLinkTargets('road').items;
    expect(items.map((i) => [i.kind, i.title])).toEqual([
      ['note', 'Road trip'],
      ['document', 'Roadmap deck'],
    ]);
    expect(items[1]).toEqual({ kind: 'document', id: document.id, title: 'Roadmap deck', path: ['Common'], documentKind: 'pptx' });
    // A subsequence finds it too.
    expect(s.palette.searchLinkTargets('rdmp').items.map((i) => i.title)).toEqual(['Roadmap deck']);
  });

  it('Markdown export writes a link as the text it shows', async () => {
    const md = richToMarkdown('T', { content: [linkPara(P, 'See ', randomUUID(), null, 'Deck')] }, { linkOf: () => null, linkedFileUrl: () => null });
    expect(md).toBe('# T\n\nSee Deck\n');
  });
});
