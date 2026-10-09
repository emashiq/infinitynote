import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { textToDoc } from '../../src/shared/text/textarea-doc';
import { setupServices, thrown } from './hierarchy-helpers';

async function setup() {
  const s = await setupServices();
  const note = s.note(null, null, 'Drafts');
  const viewId = randomUUID();
  const save = (baseRevision: number, text: string, title?: string) =>
    s.writer.save(
      { noteId: note.id, viewId, baseRevision, requestId: randomUUID(), format: 'rich', content: textToDoc(text), ...(title ? { title } : {}) });
  /** A stale save that main keeps as a draft; returns the draft id. */
  const conflict = (text: string, title?: string): string => {
    const err = thrown(() => save(0, text, title));
    if (err.code !== 'CONFLICT') throw new Error(`expected CONFLICT, got ${err.code}`);
    return (err.details as { draftId: string }).draftId;
  };
  const op = (baseRevision: number) => ({ noteId: note.id, viewId, baseRevision, requestId: randomUUID() });
  const plain = () => s.row<{ plain_text: string; revision: number; title: string }>('SELECT plain_text, revision, title FROM notes WHERE id = ?', note.id)!;
  return { ...s, note, viewId, save, conflict, op, plain };
}

describe('recovered drafts (INF-SAVE-03)', () => {
  it('lists unresolved drafts newest first with their text', async () => {
    const s = await setup();
    s.save(0, 'current');
    const older = s.conflict('my first edit');
    s.clock.advance(10);
    const newer = s.conflict('my second edit', 'Mine');
    const { drafts } = s.drafts.list(s.note.id);
    expect(drafts.map((d) => d.id)).toEqual([newer, older]);
    expect(drafts[0]).toMatchObject({ reason: 'conflict', baseRevision: 0, format: 'rich', title: 'Mine', plainText: 'my second edit', truncated: false });
  });

  it('restore creates a conflict version of the current content, writes the draft and resolves it', async () => {
    const s = await setup();
    s.save(0, 'their text');
    const draftId = s.conflict('my lost text', 'My title');
    s.clock.advance(100);
    const res = s.drafts.resolve({ action: 'restore', ...s.op(1), draftId });
    expect(res.resolved).toBe(true);
    expect(res.content).toMatchObject({ revision: 2, format: 'rich' });
    expect(s.plain()).toEqual({ plain_text: 'my lost text', revision: 2, title: 'My title' });
    const version = s.row<{ id: string; reason: string; content_snapshot: string }>('SELECT id, reason, content_snapshot FROM note_versions WHERE note_id = ?', s.note.id)!;
    expect(version).toMatchObject({ id: res.content!.versionId, reason: 'conflict' });
    expect(version.content_snapshot).toContain('their text');
    expect(s.row<{ resolved_at: number }>('SELECT resolved_at FROM note_drafts WHERE id = ?', draftId)!.resolved_at).toBe(s.clock.now());
    expect(s.drafts.list(s.note.id).drafts).toEqual([]);
    expect(thrown(() => s.drafts.resolve({ action: 'restore', ...s.op(2), draftId })).code).toBe('NOT_FOUND');
  });

  it('dismiss resolves without changing the note and needs no lease', async () => {
    const s = await setup();
    s.save(0, 'kept');
    const draftId = s.conflict('dropped');
    expect(s.drafts.resolve({ action: 'dismiss', noteId: s.note.id, draftId })).toEqual({ resolved: true, content: null });
    expect(s.plain()).toMatchObject({ plain_text: 'kept', revision: 1 });
    expect(thrown(() => s.drafts.resolve({ action: 'dismiss', noteId: s.note.id, draftId })).code).toBe('NOT_FOUND');
  });

  it("restore or dismiss of another note's draft is refused", async () => {
    const s = await setup();
    s.save(0, 'a');
    const draftId = s.conflict('mine');
    const other = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Other').note;
    const otherView = randomUUID();
    const req = { action: 'restore' as const, noteId: other.id, viewId: otherView, baseRevision: 0, requestId: randomUUID(), draftId };
    expect(thrown(() => s.drafts.resolve(req)).code).toBe('NOT_FOUND');
    expect(thrown(() => s.drafts.resolve({ action: 'dismiss', noteId: other.id, draftId })).code).toBe('NOT_FOUND');
    expect(s.drafts.list(s.note.id).drafts).toHaveLength(1);
  });

  it('a stale restore is CONFLICT and the draft stays unresolved', async () => {
    const s = await setup();
    s.save(0, 'a');
    const draftId = s.conflict('mine');
    expect(thrown(() => s.drafts.resolve({ action: 'restore', ...s.op(0), draftId })).code).toBe('CONFLICT');
    expect(s.drafts.list(s.note.id).drafts).toHaveLength(1);
  });

  it('a draft that no longer passes the schema is VALIDATION_FAILED and stays unresolved', async () => {
    const s = await setup();
    s.save(0, 'a');
    const draftId = randomUUID();
    s.t.db
      .prepare<[string, string]>(
        "INSERT INTO note_drafts(id, note_id, view_id, base_revision, format, content, reason, created_at) VALUES (?, ?, 'v', 0, 'rich', '{\"type\":\"doc\",\"content\":[{\"type\":\"script\"}]}', 'conflict', 1)",
      )
      .run(draftId, s.note.id);
    expect(thrown(() => s.drafts.resolve({ action: 'restore', ...s.op(1), draftId })).code).toBe('VALIDATION_FAILED');
    expect(s.drafts.list(s.note.id).drafts.map((d) => d.id)).toEqual([draftId]);
    expect(s.plain().revision).toBe(1);
  });

  it('long drafts are truncated for display', async () => {
    const s = await setup();
    s.save(0, 'a');
    s.conflict('y'.repeat(25_000));
    const [draft] = s.drafts.list(s.note.id).drafts;
    expect(draft!.plainText).toHaveLength(20_000);
    expect(draft!.truncated).toBe(true);
  });
});
