import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { thrown } from './hierarchy-helpers';
import { doc, para, setupReminders } from './reminder-helpers';

/** A paragraph holding text and a reference to a note (and optionally one of its blocks). */
const refPara = (id: string, text: string, target: { noteId: string; blockId?: string | null; label?: string }) => ({
  type: 'paragraph',
  attrs: { id },
  content: [
    { type: 'text', text },
    { type: 'noteRef', attrs: { noteId: target.noteId, blockId: target.blockId ?? null, label: target.label ?? 'label', excerpt: null } },
  ],
});

async function setup() {
  const s = await setupReminders();
  const B1 = randomUUID();
  const B2 = randomUUID();
  const target = s.editable('Design');
  target.save(doc(para(B1, 'Goals of the design'), para(B2, 'Open questions')));
  const source = s.editable('Meeting');
  return { s, target, source, B1, B2 };
}

describe('note references (INF-REF-02..07, D-098)', () => {
  it('block ref: a reference to another note block is indexed with the save and listed both ways', async () => {
    const { s, target, source, B1 } = await setup();
    const P = randomUUID();
    source.save(doc(refPara(P, 'See ', { noteId: target.note.id, blockId: B1, label: 'Design' })));

    const out = s.references.list(source.note.id);
    expect(out.outgoing).toEqual([
      { targetNoteId: target.note.id, targetBlockId: B1, title: 'Design', path: ['Common'], state: 'ok', trashBatchId: null, blockText: 'Goals of the design' },
    ]);
    expect(out.backlinks).toEqual([]);
    expect(s.references.list(target.note.id).backlinks).toEqual([
      { sourceNoteId: source.note.id, sourceBlockId: P, targetBlockId: B1, title: 'Meeting', path: ['Common'], context: 'See Design' },
    ]);
    // The reference label is part of the searchable text.
    expect(s.row<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', source.note.id)!.plain_text).toBe('See Design');
  });

  it('a stale save changes no reference (one transaction with the content, INF-SAVE-02)', async () => {
    const { s, target } = await setup();
    const note = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Stale').note;
    const viewId = randomUUID();
    const lease = s.leases.acquire(note.id, viewId, 99);
    if (!lease.granted) throw new Error('lease');
    const save = (baseRevision: number, content: unknown) =>
      s.writer.save({ noteId: note.id, viewId, leaseToken: lease.leaseToken, baseRevision, requestId: randomUUID(), format: 'rich', content } as never, { webContentsId: 99 });
    save(0, doc(refPara(randomUUID(), 'x', { noteId: target.note.id })));
    const before = s.rows('SELECT * FROM note_references');
    expect(thrown(() => save(0, doc(para(randomUUID(), 'gone')))).code).toBe('CONFLICT');
    expect(s.rows('SELECT * FROM note_references')).toEqual(before);
  });

  it('rename/move: renaming or moving the target keeps the link and shows the new title and path', async () => {
    const { s, target, source, B1 } = await setup();
    const P = randomUUID();
    source.save(doc(refPara(P, 'See ', { noteId: target.note.id, blockId: B1, label: 'Design' })));
    const project = s.project('Atlas');
    s.hierarchy.renameNote(target.note.id, 'Design v2');
    s.hierarchy.moveNote(target.note.id, { projectId: project.id, folderId: null });

    const [ref] = s.references.list(source.note.id).outgoing;
    expect(ref).toMatchObject({ targetNoteId: target.note.id, targetBlockId: B1, title: 'Design v2', path: ['Atlas'], state: 'ok' });
    expect(s.references.list(target.note.id).backlinks.map((b) => b.sourceNoteId)).toEqual([source.note.id]);
    // Moving the source keeps its backlink too.
    s.hierarchy.moveNote(source.note.id, { projectId: project.id, folderId: null });
    expect(s.references.list(target.note.id).backlinks[0]).toMatchObject({ sourceNoteId: source.note.id, path: ['Atlas'] });
  });

  it('trashed target: the reference shows Trash with its batch, comes back on restore and never points elsewhere', async () => {
    const { s, target, source, B1, B2 } = await setup();
    source.save(doc(refPara(randomUUID(), 'a ', { noteId: target.note.id, blockId: B1 }), refPara(randomUUID(), 'b ', { noteId: target.note.id })));
    const { trashBatchId } = s.trash.trashNote(target.note.id);
    expect(s.references.list(source.note.id).outgoing.map((r) => [r.state, r.trashBatchId, r.title])).toEqual([
      ['trashed', trashBatchId, 'Design'],
      ['trashed', trashBatchId, 'Design'],
    ]);
    s.trash.restore(trashBatchId);
    expect(s.references.list(source.note.id).outgoing.map((r) => r.state)).toEqual(['ok', 'ok']);

    // The block disappears from the target: only the block reference says so; the note reference is still fine.
    target.save(doc(para(B2, 'Open questions')));
    expect(s.references.list(source.note.id).outgoing.map((r) => [r.state, r.blockText])).toEqual([
      ['blockMissing', null],
      ['ok', null],
    ]);

    // Purged: the reference says the note no longer exists, with the title it had.
    s.hierarchy.renameNote(target.note.id, 'Design final');
    s.trash.purge({ target: { kind: 'batch', batchId: s.trash.trashNote(target.note.id).trashBatchId }, confirmed: true });
    expect(s.references.list(source.note.id).outgoing.map((r) => [r.state, r.title, r.path])).toEqual([
      ['missing', 'Design final', []],
      ['missing', 'Design final', []],
    ]);
  });

  it('a trashed source drops out of the backlinks until it is restored; a self reference is not a backlink', async () => {
    const { s, target, source } = await setup();
    source.save(doc(refPara(randomUUID(), 'x', { noteId: target.note.id })));
    target.save(doc(refPara(randomUUID(), 'self', { noteId: target.note.id })));
    expect(s.references.list(target.note.id).backlinks.map((b) => b.sourceNoteId)).toEqual([source.note.id]);
    const { trashBatchId } = s.trash.trashNote(source.note.id);
    expect(s.references.list(target.note.id).backlinks).toEqual([]);
    s.trash.restore(trashBatchId);
    expect(s.references.list(target.note.id).backlinks.map((b) => b.sourceNoteId)).toEqual([source.note.id]);
    expect(s.references.list(target.note.id).outgoing.map((r) => r.targetNoteId)).toEqual([target.note.id]);
  });

  it('duplicate content: copied blocks never alias the original block IDs', async () => {
    const { s, target, source, B1, B2 } = await setup();
    source.save(doc(refPara(randomUUID(), 'See ', { noteId: target.note.id, blockId: B1 })));
    // Another note stores a copy of the target's content with the same block IDs.
    const copy = s.editable('Copy of design');
    copy.save(doc(para(B1, 'Goals of the design'), para(B2, 'Open questions')));
    expect(s.references.list(copy.note.id).backlinks).toEqual([]);
    expect(s.references.list(source.note.id).outgoing).toMatchObject([{ targetNoteId: target.note.id, targetBlockId: B1, state: 'ok' }]);

    // Inside one note, a pasted duplicate of a block ID is dropped from the second copy, so a block reference
    // has exactly one block to point at, and a reference inside the copy has no source block.
    const dup = s.editable('Pasted twice');
    const X = randomUUID();
    dup.save(doc(para(X, 'first'), refPara(X, 'second ', { noteId: target.note.id })));
    const stored = JSON.parse(s.row<{ content_json: string }>('SELECT content_json FROM notes WHERE id = ?', dup.note.id)!.content_json);
    expect(stored.content.map((n: { attrs?: { id?: string } }) => n.attrs?.id ?? null)).toEqual([X, null]);
    expect(s.rows('SELECT source_block_id FROM note_references WHERE source_note_id = ?', dup.note.id)).toEqual([{ source_block_id: null }]);
  });

  it('plain notes hold no references; converting to plain text removes the outgoing ones', async () => {
    const { s, target, source } = await setup();
    source.save(doc(refPara(randomUUID(), 'See ', { noteId: target.note.id, label: 'Design' })));
    expect(s.references.list(source.note.id).outgoing).toHaveLength(1);
    source.convert('plain');
    expect(s.references.list(source.note.id).outgoing).toEqual([]);
    expect(s.row<{ content_text: string }>('SELECT content_text FROM notes WHERE id = ?', source.note.id)!.content_text).toBe('See Design');
  });

  it('a reference to an unknown note keeps its label as the title and shows it as missing', async () => {
    const { s, source } = await setup();
    source.save(doc(refPara(randomUUID(), 'x', { noteId: randomUUID(), label: 'Old idea' })));
    expect(s.references.list(source.note.id).outgoing).toMatchObject([{ state: 'missing', title: 'Old idea', path: [] }]);
  });

  it('the picker lists the textblocks of a live note, filtered by the query', async () => {
    const { s, target, B1, B2 } = await setup();
    expect(s.references.pickBlocks(target.note.id, '')).toEqual({
      format: 'rich',
      blocks: [
        { blockId: B1, kind: 'paragraph', text: 'Goals of the design' },
        { blockId: B2, kind: 'paragraph', text: 'Open questions' },
      ],
    });
    expect(s.references.pickBlocks(target.note.id, 'QUEST').blocks.map((b) => b.blockId)).toEqual([B2]);
    const plain = s.editable('Plain', 'plain');
    plain.save('one\ntwo');
    expect(s.references.pickBlocks(plain.note.id, '')).toEqual({ format: 'plain', blocks: [] });
    s.trash.trashNote(target.note.id);
    expect(thrown(() => s.references.pickBlocks(target.note.id, '')).code).toBe('NOT_FOUND');
  });
});
