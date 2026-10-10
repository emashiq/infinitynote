import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { GraphBuildRequestType, GraphModelType } from '../../src/shared/contracts/graph';
import type { RichDocLike } from '../../src/shared/editor/doc-schema';
import { fixtureBytes } from './document-helpers';
import { setupServices, type Services } from './hierarchy-helpers';

const PASSWORD = 'correct horse battery';

function save(s: Services, noteId: string, content: RichDocLike) {
  const revision = s.row<{ revision: number }>('SELECT revision FROM notes WHERE id = ?', noteId)!.revision;
  return s.writer.save({ noteId, viewId: randomUUID(), baseRevision: revision, requestId: randomUUID(), format: 'rich', content });
}

const links = (...chips: unknown[]): RichDocLike => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: 'See ' }, ...chips] }] });
const noteRef = (noteId: string) => ({ type: 'noteRef', attrs: { noteId, blockId: null, label: 'x', excerpt: null, alias: null } });
const docRef = (documentId: string) => ({ type: 'docRef', attrs: { documentId, target: null, label: 'x', alias: null } });

const ALL: GraphBuildRequestType = { scope: { kind: 'all' }, kinds: ['note', 'document'], tag: null, includeOrphans: true };

/** Titles of the nodes and "a -> b" for the edges, sorted, for readable assertions. */
function shape(model: GraphModelType) {
  const title = (i: number) => model.nodes[i]!.title;
  return {
    nodes: model.nodes.map((n) => n.title).sort(),
    edges: model.edges.map((e) => [title(e.source), title(e.target)].sort().join(' - ') + ` (${e.kind})`).sort(),
  };
}

/** Project Atlas with folder Specs › Deep; a note in each place, a Common note and a document; links between them. */
async function notebook() {
  const s = await setupServices();
  const atlas = s.project('Atlas');
  const specs = s.folder(atlas.id, null, 'Specs');
  const deep = s.folder(atlas.id, specs.id, 'Deep');
  const root = s.note(atlas.id, null, 'Atlas root');
  const spec = s.note(atlas.id, specs.id, 'Spec');
  const inner = s.note(atlas.id, deep.id, 'Inner');
  const common = s.note(null, null, 'Common note');
  const lonely = s.note(atlas.id, null, 'Lonely');
  const { document } = await s.documents.createBlank('docx', { projectId: atlas.id, folderId: specs.id }, 'Spec doc');
  save(s, root.id, links(noteRef(spec.id), docRef(document.id)));
  save(s, spec.id, links(noteRef(root.id), noteRef(inner.id)));
  save(s, common.id, links(noteRef(root.id)));
  return { s, atlas, specs, deep, root, spec, inner, common, lonely, document };
}

describe('relation graph model (F10, D-170)', () => {
  it('all items with their links: notes and document links, each pair joined once whatever the direction', async () => {
    const { s } = await notebook();
    expect(shape(s.graph.build(ALL))).toEqual({
      nodes: ['Atlas root', 'Common note', 'Inner', 'Lonely', 'Spec', 'Spec doc'],
      edges: ['Atlas root - Common note (reference)', 'Atlas root - Spec (reference)', 'Atlas root - Spec doc (documentLink)', 'Inner - Spec (reference)'],
    });
    const root = s.graph.build(ALL).nodes.find((n) => n.title === 'Atlas root')!;
    expect(root).toMatchObject({ kind: 'note', degree: 3, documentKind: null, locked: false });
  });

  it('scopes: Common, a project, a folder with its subtree; links leaving the scope are left out', async () => {
    const { s, atlas, specs, deep } = await notebook();
    expect(shape(s.graph.build({ ...ALL, scope: { kind: 'common' } })).nodes).toEqual(['Common note']);
    expect(shape(s.graph.build({ ...ALL, scope: { kind: 'project', projectId: atlas.id } })).edges).not.toContain('Atlas root - Common note (reference)');
    expect(shape(s.graph.build({ ...ALL, scope: { kind: 'folder', folderId: specs.id } }))).toEqual({
      nodes: ['Inner', 'Spec', 'Spec doc'],
      edges: ['Inner - Spec (reference)'],
    });
    expect(shape(s.graph.build({ ...ALL, scope: { kind: 'folder', folderId: deep.id } })).nodes).toEqual(['Inner']);
  });

  it('filters by kind and tag and leaves out unlinked items when asked', async () => {
    const { s, root, spec } = await notebook();
    expect(shape(s.graph.build({ ...ALL, kinds: ['document'] })).nodes).toEqual(['Spec doc']);
    expect(shape(s.graph.build({ ...ALL, includeOrphans: false })).nodes).not.toContain('Lonely');
    s.tags.set(root.id, ['core']);
    s.tags.set(spec.id, ['core']);
    expect(shape(s.graph.build({ ...ALL, tag: 'core' }))).toEqual({ nodes: ['Atlas root', 'Spec'], edges: ['Atlas root - Spec (reference)'] });
  });

  it('trashed items and their links leave the graph; a locked note stays by title only', async () => {
    const { s, spec, root } = await notebook();
    s.trash.trashNote(spec.id);
    expect(shape(s.graph.build(ALL)).nodes).not.toContain('Spec');
    await s.locks.lock({ noteId: root.id, password: PASSWORD, hello: false });
    const locked = s.graph.build(ALL).nodes.find((n) => n.id === root.id)!;
    expect(locked).toMatchObject({ title: 'Atlas root', locked: true });
    expect(Object.keys(locked).sort()).toEqual(['degree', 'documentKind', 'folderId', 'id', 'kind', 'locked', 'projectId', 'title']);
  });

  it('a document opened in the app from a note’s attached file is joined to the note', async () => {
    const s = await setupServices();
    const source = s.note(null, null, 'Has attachment');
    const { attachment } = await s.attachments.importBytes({ kind: 'document', originalName: 'Brief.xlsx', bytes: fixtureBytes('sample.xlsx') });
    save(s, source.id, {
      type: 'doc',
      content: [{ type: 'fileAttachment', attrs: { id: randomUUID(), attachmentId: attachment.id, name: 'Brief.xlsx', sizeBytes: attachment.sizeBytes, mime: attachment.mime } }],
    });
    await s.documents.fromAttachment(source.id, attachment.id);
    expect(shape(s.graph.build(ALL)).edges).toEqual(['Brief - Has attachment (file)']);
  });

  it('the local graph holds the items within 1 to 3 links in any direction, across scopes', async () => {
    const { s, inner, common } = await notebook();
    const titles = (depth: number) => shape(s.graph.local({ item: { kind: 'note', id: inner.id }, depth })).nodes;
    expect(titles(1)).toEqual(['Inner', 'Spec']);
    expect(titles(2)).toEqual(['Atlas root', 'Inner', 'Spec']);
    expect(titles(3)).toEqual(['Atlas root', 'Common note', 'Inner', 'Spec', 'Spec doc']);
    expect(shape(s.graph.local({ item: { kind: 'note', id: common.id }, depth: 1 })).edges).toEqual(['Atlas root - Common note (reference)']);
    expect(s.graph.local({ item: { kind: 'document', id: randomUUID() }, depth: 1 }).nodes).toEqual([]);
  });
});
