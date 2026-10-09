import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { setupServices, thrown, type Services } from './hierarchy-helpers';

const match = (s: Services, q: string) =>
  s.rows<{ rowid: number }>('SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?', q).length;

async function sample() {
  const s = await setupServices();
  const p = s.project('Alpha');
  const l1 = s.folder(p.id, null, 'L1');
  const l2 = s.folder(p.id, l1.id, 'L2');
  const l3 = s.folder(p.id, l2.id, 'L3');
  const n1 = s.note(p.id, l1.id, 'findme one');
  const n3 = s.note(p.id, l3.id, 'deep');
  return { s, p, l1, l2, l3, n1, n3 };
}

describe('trash batches', () => {
  it('reports counts and trashedNoteIds and creates one batch per call', async () => {
    const { s, l2, n3, p } = await sample();
    const r = s.trash.trashFolder(l2.id);
    expect(r.counts).toEqual({ projects: 0, folders: 2, notes: 1 });
    expect(r.trashedNoteIds).toEqual([n3.id]);
    expect(s.events.at(-1)).toEqual({ reason: 'trash', trashedNoteIds: [n3.id] });
    const batches = s.rows<{ b: string }>('SELECT DISTINCT trash_batch_id AS b FROM folders WHERE deleted_at IS NOT NULL');
    expect(batches).toEqual([{ b: r.trashBatchId }]);
    const pr = s.trash.trashProject(p.id);
    expect(pr.counts).toEqual({ projects: 1, folders: 1, notes: 1 });
    expect(pr.trashBatchId).not.toBe(r.trashBatchId);
    expect(thrown(() => s.trash.trashFolder(l2.id)).code).toBe('NOT_FOUND');
  });

  it('removes trashed notes from search and restores them to the index', async () => {
    const { s, l1, n1 } = await sample();
    expect(match(s, 'findme')).toBe(1);
    const r = s.trash.trashFolder(l1.id);
    expect(match(s, 'findme')).toBe(0);
    s.trash.restore(r.trashBatchId);
    expect(match(s, 'findme')).toBe(1);
    expect(s.palette.searchTitles('findme').results.map((x) => x.id)).toEqual([n1.id]);
    s.t.db.exec("INSERT INTO notes_fts(notes_fts) VALUES('integrity-check')");
  });
});

describe('restore after the original parent was purged (QA-P02-4)', () => {
  it('reports relocated and the nearest surviving ancestor', async () => {
    const { s, l1, l2, l3, p } = await sample();
    const child = s.trash.trashFolder(l3.id);
    s.tick();
    const parent = s.trash.trashFolder(l2.id);
    s.trash.purge({ target: { kind: 'batch', batchId: parent.trashBatchId }, confirmed: true });
    const restored = s.trash.restore(child.trashBatchId);
    expect(restored).toMatchObject({ kind: 'folder', id: l3.id, relocated: true, location: { projectId: p.id, folderId: l1.id } });
    expect(restored.path).toEqual(['Alpha', 'L1']);
    expect(s.rows('SELECT batch_id FROM trash_reanchored')).toEqual([]);
  });

  it('a note whose project was purged restores to Common as relocated; an ordinary restore is not relocated', async () => {
    const { s, p, n1, l1 } = await sample();
    const note = s.trash.trashNote(n1.id);
    s.tick();
    const proj = s.trash.trashProject(p.id);
    s.trash.purge({ target: { kind: 'batch', batchId: proj.trashBatchId }, confirmed: true });
    expect(s.trash.restore(note.trashBatchId)).toMatchObject({ relocated: true, location: { projectId: null, folderId: null } });
    const again = await sample();
    const r = again.s.trash.trashFolder(again.l1.id);
    expect(again.s.trash.restore(r.trashBatchId).relocated).toBe(false);
    void l1;
  });
});

describe('trash list', () => {
  it('has exactly one root per batch with fromPath and contains', async () => {
    const { s, l2, n1, p } = await sample();
    const cn = s.note(null, null, 'common note', true);
    s.tick();
    s.trash.trashFolder(l2.id);
    s.tick();
    s.trash.trashNote(n1.id);
    s.tick();
    s.trash.trashNote(cn.id);
    const items = s.trash.list().items;
    expect(items.map((i) => [i.kind, i.label])).toEqual([
      ['note', 'common note'],
      ['note', 'findme one'],
      ['folder', 'L2'],
    ]);
    expect(items[0]).toMatchObject({ fromPath: ['Common'], sticky: true, contains: { folders: 0, notes: 0 } });
    expect(items[1]).toMatchObject({ fromPath: ['Alpha', 'L1'], sticky: false });
    expect(items[2]).toMatchObject({ fromPath: ['Alpha', 'L1'], contains: { folders: 1, notes: 1 } });
    s.tick();
    s.trash.trashProject(p.id);
    const withProject = s.trash.list().items;
    expect(withProject[0]).toMatchObject({ kind: 'project', label: 'Alpha', fromPath: [] });
    expect(withProject).toHaveLength(4);
  });
});

describe('restore (INF-HIER-09)', () => {
  it('restores to the original location', async () => {
    const { s, l1, l2, n3 } = await sample();
    const r = s.trash.trashFolder(l2.id);
    const out = s.trash.restore(r.trashBatchId);
    expect(out).toMatchObject({ kind: 'folder', id: l2.id, relocated: false, path: ['Alpha', 'L1'], restoredNoteIds: [n3.id] });
    expect(out.location).toMatchObject({ folderId: l1.id });
    expect(s.hierarchy.list().folders).toHaveLength(3);
    expect(s.trash.list().items).toEqual([]);
    expect(thrown(() => s.trash.restore(r.trashBatchId))).toMatchObject({ code: 'NOT_FOUND', message: 'That item is no longer in Trash.' });
  });

  it('restores a note to the nearest live ancestor when its folder is trashed', async () => {
    const { s, p, l1, l2, n3 } = await sample();
    const nb = s.trash.trashNote(n3.id);
    s.trash.trashFolder(l2.id);
    const out = s.trash.restore(nb.trashBatchId);
    expect(out).toMatchObject({ kind: 'note', relocated: true, path: ['Alpha', 'L1'] });
    expect(out.location).toEqual({ projectId: p.id, folderId: l1.id });
    expect(s.row<{ folder_id: string }>('SELECT folder_id FROM notes WHERE id = ?', n3.id)?.folder_id).toBe(l1.id);
    s.check();
  });

  it('restores to the scope root when no ancestor is live', async () => {
    const { s, p, n1, l1 } = await sample();
    const nb = s.trash.trashNote(n1.id);
    s.trash.trashFolder(l1.id);
    const out = s.trash.restore(nb.trashBatchId);
    expect(out).toMatchObject({ relocated: true, path: ['Alpha'], location: { projectId: p.id, folderId: null } });
    s.check();
  });

  it('restores to Common when the project is trashed, moving a whole folder subtree', async () => {
    const { s, p, l1, l2, l3, n3 } = await sample();
    const fb = s.trash.trashFolder(l2.id);
    s.trash.trashProject(p.id);
    const out = s.trash.restore(fb.trashBatchId);
    expect(out).toMatchObject({ kind: 'folder', relocated: true, path: ['Common'], location: { projectId: null, folderId: null } });
    s.check();
    for (const id of [l2.id, l3.id]) {
      expect(s.row<{ project_id: string | null; deleted_at: number | null }>('SELECT project_id, deleted_at FROM folders WHERE id = ?', id)).toEqual({ project_id: null, deleted_at: null });
    }
    expect(s.row<{ project_id: string | null; folder_id: string; deleted_at: number | null }>('SELECT project_id, folder_id, deleted_at FROM notes WHERE id = ?', n3.id)).toEqual({
      project_id: null,
      folder_id: l3.id,
      deleted_at: null,
    });
    expect(s.row<{ parent_id: string | null }>('SELECT parent_id FROM folders WHERE id = ?', l2.id)?.parent_id).toBeNull();
    // l1 remains in the trashed project
    expect(s.row<{ project_id: string }>('SELECT project_id FROM folders WHERE id = ?', l1.id)?.project_id).toBe(p.id);
  });

  it('a nested earlier batch is not restored by a later batch', async () => {
    const { s, l1, l3, n3 } = await sample();
    s.trash.trashFolder(l3.id); // earlier, inner
    const outer = s.trash.trashFolder(l1.id);
    s.trash.restore(outer.trashBatchId);
    expect(s.row<{ deleted_at: number | null }>('SELECT deleted_at FROM folders WHERE id = ?', l3.id)?.deleted_at).not.toBeNull();
    expect(s.row<{ deleted_at: number | null }>('SELECT deleted_at FROM notes WHERE id = ?', n3.id)?.deleted_at).not.toBeNull();
    s.check();
    const items = s.trash.list().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'folder', label: 'L3', fromPath: ['Alpha', 'L1', 'L2'] });
    const back = s.trash.restore(items[0]!.batchId);
    expect(back.relocated).toBe(false);
    s.check();
  });

  it('restoring an inner batch while its parent is still trashed relocates it', async () => {
    const { s, p, l1, l3 } = await sample();
    const inner = s.trash.trashFolder(l3.id);
    s.trash.trashFolder(l1.id);
    const out = s.trash.restore(inner.trashBatchId);
    expect(out).toMatchObject({ relocated: true, path: ['Alpha'], location: { projectId: p.id, folderId: null } });
    s.check();
  });

  it('restoring a project restores it in place', async () => {
    const { s, p } = await sample();
    const pb = s.trash.trashProject(p.id);
    const out = s.trash.restore(pb.trashBatchId);
    expect(out).toMatchObject({ kind: 'project', id: p.id, relocated: false, path: ['Alpha'] });
    expect(s.hierarchy.list().notes).toHaveLength(2);
    s.check();
  });
});

describe('purge (INF-HIER-09)', () => {
  it('purging a note removes its reminders, occurrences, deliveries, sources and dismissals in the same transaction (D-073, D-088)', async () => {
    const s = await setupServices({ now: Date.parse('2026-10-08T07:00:00Z') });
    const n = s.note(null, null, 'With reminder');
    const dto = s.reminders.create({
      noteId: n.id,
      blockId: null,
      title: 'Pay rent',
      zoneId: 'Asia/Dhaka',
      date: '2026-10-09',
      time: '17:00',
      recurrence: null,
      foldPreference: 'earlier',
      followup: null,
      allowPast: false,
    });
    s.t.db
      .prepare<[string, string]>(
        "INSERT INTO alert_deliveries(id, occurrence_id, alert_sequence, kind, presentation, batch_id, reason, claimed_at, outcome) VALUES (?, ?, 0, 'initial', 'single', 'b', 'timer', 1, 'dispatched')",
      )
      .run(randomUUID(), dto.current!.occurrenceId);
    s.t.db
      .prepare<[string, string]>(
        `INSERT INTO reminder_sources(reminder_id, note_id, block_id, source_text, span_start, span_end, span_ordinal, reference_instant_utc, reference_zone, parser_version, origin, created_at, updated_at)
         VALUES (?, ?, NULL, 'tomorrow', NULL, NULL, 0, 1, 'Asia/Dhaka', 1, 'suggestion', 1, 1)`,
      )
      .run(dto.id, n.id);
    s.suggestions.dismiss({ noteId: n.id, blockId: randomUUID(), text: 'Friday', spanOrdinal: 0, referenceDate: '2026-10-08' });
    const tables = ['reminders', 'occurrences', 'alert_deliveries', 'reminder_sources', 'suggestion_dismissals'];
    const count = (table: string) => s.row<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)!.n;
    const r = s.trash.trashNote(n.id);
    expect(tables.map(count)).toEqual([1, 1, 1, 1, 1]);
    s.trash.purge({ target: { kind: 'batch', batchId: r.trashBatchId }, confirmed: true });
    expect(tables.map(count)).toEqual([0, 0, 0, 0, 0]);
  });


  it('requires confirmation at the schema level', async () => {
    const { CHANNEL_SCHEMAS } = await import('../../src/shared/contracts/channels');
    expect(CHANNEL_SCHEMAS['trash:purge'].request.safeParse({ target: { kind: 'all' } }).success).toBe(false);
  });

  it('purges a 5-level folder batch deepest-first', async () => {
    const s = await setupServices();
    const p = s.project('P');
    let parent: string | null = null;
    let first = '';
    for (let i = 0; i < 5; i += 1) {
      parent = s.folder(p.id, parent, `D${i}`).id;
      if (i === 0) first = parent;
      s.note(p.id, parent, `n${i}`);
    }
    const r = s.trash.trashFolder(first);
    expect(r.counts).toEqual({ projects: 0, folders: 5, notes: 5 });
    expect(s.trash.purge({ target: { kind: 'batch', batchId: r.trashBatchId }, confirmed: true })).toEqual({ purged: { projects: 0, folders: 5, notes: 5 } });
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM folders')?.n).toBe(0);
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM notes')?.n).toBe(0);
    s.check();
    expect(thrown(() => s.trash.purge({ target: { kind: 'batch', batchId: r.trashBatchId }, confirmed: true })).code).toBe('NOT_FOUND');
  });

  it('re-anchors an orphan from another batch to the nearest surviving ancestor', async () => {
    const { s, p, l1, l2, l3, n3 } = await sample();
    const nb = s.trash.trashNote(n3.id); // earlier batch, lives in L3
    const outer = s.trash.trashFolder(l2.id); // L2 + L3
    s.trash.purge({ target: { kind: 'batch', batchId: outer.trashBatchId }, confirmed: true });
    expect(s.row<{ folder_id: string | null; project_id: string | null }>('SELECT folder_id, project_id FROM notes WHERE id = ?', n3.id)).toEqual({ folder_id: l1.id, project_id: p.id });
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM folders WHERE id IN (?, ?)', l2.id, l3.id)?.n).toBe(0);
    s.check();
    const out = s.trash.restore(nb.trashBatchId);
    expect(out).toMatchObject({ relocated: true, path: ['Alpha', 'L1'] });
  });

  it('re-anchors orphans to Common when their project is purged', async () => {
    const { s, p, l3, n3, l1 } = await sample();
    const nb = s.trash.trashNote(n3.id);
    const fb = s.trash.trashFolder(l3.id);
    const pb = s.trash.trashProject(p.id);
    s.trash.purge({ target: { kind: 'batch', batchId: pb.trashBatchId }, confirmed: true });
    // l3 batch (folder) and n3 (note) survive, anchored to Common
    expect(s.row<{ project_id: string | null; parent_id: string | null }>('SELECT project_id, parent_id FROM folders WHERE id = ?', l3.id)).toEqual({ project_id: null, parent_id: null });
    expect(s.row<{ project_id: string | null; folder_id: string | null }>('SELECT project_id, folder_id FROM notes WHERE id = ?', n3.id)).toEqual({ project_id: null, folder_id: l3.id });
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM folders WHERE id = ?', l1.id)?.n).toBe(0);
    s.check();
    expect(s.trash.restore(fb.trashBatchId)).toMatchObject({ relocated: true, path: ['Common'] });
    expect(s.trash.restore(nb.trashBatchId)).toMatchObject({ relocated: true });
    s.check();
  });

  it('cascades versions and drafts, and marks orphaned attachments unreferenced', async () => {
    const s = await setupServices();
    const n = s.note(null, null, 'doomed');
    const keep = s.note(null, null, 'keep');
    const attachment = (id: string, hash: string, path: string) =>
      s.t.db
        .prepare<[string, string, string]>(
          `INSERT INTO attachments(id, managed_relative_path, sha256, mime, size_bytes, kind, created_at) VALUES (?, ?, ?, 'image/png', 1, 'image', 1)`,
        )
        .run(id, path, hash);
    const a1 = randomUUID();
    const a2 = randomUUID();
    attachment(a1, 'a'.repeat(64), 'attachments/aa/one.png');
    attachment(a2, 'b'.repeat(64), 'attachments/bb/two.png');
    s.t.db.prepare<[string, string]>('INSERT INTO note_attachments(note_id, attachment_id) VALUES (?, ?)').run(n.id, a1);
    s.t.db.prepare<[string, string]>('INSERT INTO note_attachments(note_id, attachment_id) VALUES (?, ?)').run(keep.id, a2);
    s.t.db
      .prepare<[string, string]>(
        "INSERT INTO note_versions(id, note_id, revision, format, content_snapshot, reason, created_at) VALUES (?, ?, 0, 'rich', '{}', 'auto', 1)",
      )
      .run(randomUUID(), n.id);
    s.t.db
      .prepare<[string, string]>(
        "INSERT INTO note_drafts(id, note_id, view_id, base_revision, format, content, reason, created_at) VALUES (?, ?, 'v', 0, 'rich', '{}', 'conflict', 1)",
      )
      .run(randomUUID(), n.id);
    const r = s.trash.trashNote(n.id);
    s.trash.purge({ target: { kind: 'batch', batchId: r.trashBatchId }, confirmed: true });
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM note_versions')?.n).toBe(0);
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM note_drafts')?.n).toBe(0);
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM note_attachments')?.n).toBe(1);
    expect(s.row<{ unreferenced_since: number | null }>('SELECT unreferenced_since FROM attachments WHERE id = ?', a1)?.unreferenced_since).not.toBeNull();
    expect(s.row<{ unreferenced_since: number | null }>('SELECT unreferenced_since FROM attachments WHERE id = ?', a2)?.unreferenced_since).toBeNull();
  });

  it('empties the trash and excludes trashed and purged rows from tree, home and palette', async () => {
    const { s, p, l1, n1 } = await sample();
    s.hierarchy.setPinned(n1.id, true);
    s.trash.trashFolder(l1.id);
    s.trash.trashProject(p.id);
    expect(s.hierarchy.list()).toEqual({ projects: [], folders: [], notes: [] });
    expect(s.home.summary({ kind: 'all' })).toMatchObject({ pinned: [], pinnedTotal: 0, recent: [] });
    expect(s.palette.searchTitles('findme').results).toEqual([]);
    expect(s.trash.list().items).toHaveLength(2);
    expect(s.trash.purge({ target: { kind: 'all' }, confirmed: true })).toEqual({ purged: { projects: 1, folders: 3, notes: 2 } });
    expect(s.trash.list().items).toEqual([]);
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM notes')?.n).toBe(0);
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM projects')?.n).toBe(0);
    expect(s.trash.purge({ target: { kind: 'all' }, confirmed: true })).toEqual({ purged: { projects: 0, folders: 0, notes: 0 } });
    s.check();
  });
});
