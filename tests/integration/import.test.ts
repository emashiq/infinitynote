import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PORTABLE_DATA_ENTRY, parsePortableDocument } from '../../src/main/portability/portable-format';
import { openArchive } from '../../src/main/portability/zip-archive';
import { setupServices, type Services } from './hierarchy-helpers';
import { paragraph, saveDoc, seedNotebook, tmpFile } from './portability-helpers';

const CTX = { webContentsId: 1 };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[] };
const docOf = (s: Services, noteId: string) => JSON.parse(s.row<{ c: string }>('SELECT content_json AS c FROM notes WHERE id = ?', noteId)!.c) as Node;
const find = (node: Node, type: string): Node | undefined =>
  node.type === type ? node : (node.content ?? []).map((c) => find(c, type)).find((x) => x !== undefined);

async function exportFrom(s: Services) {
  const file = tmpFile('notes.infinityexport');
  s.pathQueue.push(file);
  const res = await s.portability.exportPortable(CTX);
  if (res.canceled) throw new Error('canceled');
  return { file, res };
}

async function importInto(s: Services, file: string) {
  s.pathQueue.push(file);
  const res = await s.portability.importPortable(CTX);
  if (res.canceled) throw new Error('canceled');
  return res;
}

const noteByTitle = (s: Services, title: string, notIn: string[] = []) =>
  s.rows<{ id: string; project_id: string | null; folder_id: string | null; favorite: number; pinned_at: number | null; sticky_enabled: number; color: string | null }>(
    'SELECT id, project_id, folder_id, favorite, pinned_at, sticky_enabled, color FROM notes WHERE title = ? AND deleted_at IS NULL',
    title,
  ).find((n) => !notIn.includes(n.id))!;

describe('portable export and import (INF-PORT-04)', () => {
  it('remap: a new notebook gets fresh IDs for every item, block and reference, with reminders on the new blocks', async () => {
    const a = await setupServices();
    const seeded = await seedNotebook(a);
    const { file, res } = await exportFrom(a);
    expect(res.counts).toEqual({ projects: 1, folders: 1, notes: 3, reminders: 1, attachments: 1 });
    expect(a.pathDialogs.at(-1)?.defaultName).toMatch(/^Infinity Notes export \d{4}-\d{2}-\d{2}\.infinityexport$/);

    const b = await setupServices();
    const imported = await importInto(b, file);
    expect(imported).toMatchObject({ canceled: false, counts: { projects: 1, folders: 1, notes: 3, reminders: 1, attachments: 1 }, skippedReminders: 0 });
    expect(imported.folderName).toMatch(/^Imported \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    const oldIds = [seeded.alpha.id, seeded.plans.id, seeded.design.id, seeded.index.id, seeded.plain.id, seeded.attachment.id, seeded.block];
    const design = noteByTitle(b, 'Design');
    const index = noteByTitle(b, 'Index');
    const plain = noteByTitle(b, 'Plain');
    for (const id of [design.id, index.id, plain.id, design.project_id!, design.folder_id!]) expect(oldIds).not.toContain(id);
    // Projects arrive as projects; Common items in the new Common folder.
    expect(b.rows('SELECT name FROM projects')).toEqual([{ name: 'Alpha' }]);
    const importFolder = b.row<{ id: string; project_id: string | null; parent_id: string | null }>('SELECT id, project_id, parent_id FROM folders WHERE name = ?', imported.folderName)!;
    expect(importFolder).toMatchObject({ project_id: null, parent_id: null });
    expect([index.folder_id, plain.folder_id]).toEqual([importFolder.id, importFolder.id]);
    expect(b.row('SELECT name, project_id FROM folders WHERE id = ?', design.folder_id)).toEqual({ name: 'Plans', project_id: design.project_id });
    // Flags and tags travel.
    expect(design.favorite).toBe(1);
    expect(index.pinned_at).not.toBeNull();
    expect({ sticky: index.sticky_enabled, color: index.color }).toEqual({ sticky: 1, color: 'blue' });
    expect(b.tags.list(design.id).tags.map((t) => t.name)).toEqual(['q4', 'work']);

    // Blocks, images and references are rewritten to the new IDs.
    const designDoc = docOf(b, design.id);
    const newBlock = (find(designDoc, 'paragraph')!.attrs!.id as string) ?? '';
    expect(newBlock).not.toBe(seeded.block);
    const image = find(designDoc, 'image')!;
    const stored = b.row<{ id: string; sha256: string; managed_relative_path: string }>('SELECT id, sha256, managed_relative_path FROM attachments')!;
    expect(image.attrs!.attachmentId).toBe(stored.id);
    expect(stored.sha256).toBe(sha(seeded.png));
    expect(sha(fs.readFileSync(path.join(b.dataDir, stored.managed_relative_path)))).toBe(sha(seeded.png));
    expect(find(docOf(b, index.id), 'noteRef')!.attrs).toMatchObject({ noteId: design.id, blockId: newBlock, label: 'Design' });
    expect(b.references.list(design.id).backlinks.map((l) => [l.sourceNoteId, l.targetBlockId])).toEqual([[index.id, newBlock]]);
    expect(b.reminders.listForNote(design.id).reminders.map((r) => ({ title: r.title, blockId: r.blockId, date: r.date, time: r.time, zoneId: r.zoneId }))).toEqual([
      { title: 'Ship it', blockId: newBlock, date: '2030-01-02', time: '09:00', zoneId: 'Asia/Dhaka' },
    ]);
    expect(b.row<{ c: string }>('SELECT content_text AS c FROM notes WHERE id = ?', plain.id)!.c).toBe('plain body');
    expect(b.search.query({ query: 'friday' }).results.map((r) => r.note.id)).toEqual([design.id]);
    expect(b.events.at(-1)).toEqual({ reason: 'create', trashedNoteIds: [] });
  });

  it('importing into the same notebook never overwrites or aliases: links to notes outside the archive stay missing', async () => {
    const a = await setupServices();
    const seeded = await seedNotebook(a);
    // A link to a note in Trash: the trashed note is not exported, so the imported link must not reach it.
    const gone = a.note(null, null, 'Gone');
    const linker = a.note(null, null, 'Linker');
    saveDoc(a, linker.id, {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'noteRef', attrs: { noteId: gone.id, blockId: null, label: 'Gone', excerpt: null } }] }],
    });
    a.trash.trashNote(gone.id);
    const before = a.rows('SELECT id, revision, content_json, content_text FROM notes ORDER BY id');
    const { file } = await exportFrom(a);
    const archive = await openArchive(file);
    const doc = parsePortableDocument(await archive.read(PORTABLE_DATA_ENTRY, 1 << 24));
    archive.close();
    expect(doc.notes.map((n) => n.title).sort()).toEqual(['Design', 'Index', 'Linker', 'Plain']);

    await importInto(a, file);
    expect(a.rows('SELECT id, revision, content_json, content_text FROM notes WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id', JSON.stringify(before.map((n) => (n as { id: string }).id)))).toEqual(before);
    expect(a.rows("SELECT id FROM notes WHERE title = 'Design'")).toHaveLength(2);
    // Identical bytes reuse the stored attachment row.
    expect(a.rows('SELECT id FROM attachments')).toEqual([{ id: seeded.attachment.id }]);
    // The original Design keeps exactly its original backlink.
    expect(a.references.list(seeded.design.id).backlinks.map((l) => l.sourceNoteId)).toEqual([seeded.index.id]);
    const copy = noteByTitle(a, 'Linker', [linker.id]);
    const ref = find(docOf(a, copy.id), 'noteRef')!.attrs!;
    expect(ref.noteId).not.toBe(gone.id);
    expect(a.references.list(copy.id).outgoing.map((o) => [o.state, o.title])).toEqual([['missing', 'Gone']]);
  });

  it('a reminder in an unknown zone is skipped and counted; a canceled dialog imports nothing', async () => {
    const a = await setupServices();
    await seedNotebook(a);
    a.t.db.prepare("UPDATE reminders SET zone_id = 'Mars/Olympus'").run();
    const { file } = await exportFrom(a);
    const b = await setupServices();
    expect(await b.portability.importPortable(CTX)).toEqual({ canceled: true });
    const res = await importInto(b, file);
    expect(res).toMatchObject({ counts: { notes: 3, reminders: 0 }, skippedReminders: 1 });
  });

  it('exports only live items and reminders that still remind', async () => {
    const a = await setupServices();
    const seeded = await seedNotebook(a);
    const done = a.reminders.create({ noteId: seeded.plain.id, blockId: null, title: 'Done one', zoneId: 'UTC', date: '2030-05-01', time: '10:00', recurrence: null, foldPreference: 'earlier', followup: null, allowPast: false });
    a.reminders.complete(done.current!.occurrenceId);
    const trashed = a.note(null, null, 'Trashed');
    saveDoc(a, trashed.id, { type: 'doc', content: [paragraph(randomUUID(), 'in trash')] });
    a.trash.trashNote(trashed.id);
    const { file, res } = await exportFrom(a);
    expect(res.counts).toMatchObject({ notes: 3, reminders: 1 });
    const archive = await openArchive(file);
    const doc = parsePortableDocument(await archive.read(PORTABLE_DATA_ENTRY, 1 << 24));
    archive.close();
    expect(doc.reminders.map((r) => r.title)).toEqual(['Ship it']);
    expect(doc.notes.find((n) => n.title === 'Trashed')).toBeUndefined();
  });
});
