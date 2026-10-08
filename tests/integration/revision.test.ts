import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NotesRepo } from '../../src/main/db/repositories/notes-repo';
import { AppError } from '../../src/main/services/app-error';
import { MAX_CONTENT_BYTES, type NoteSaveRequestType } from '../../src/shared/contracts/notes';
import { setupServices } from './hierarchy-helpers';

const WC = 7;

async function setup() {
  const { t, clock, ids, revisions, leases, writer } = await setupServices();
  const notes = new NotesRepo(t.db);
  const noteId = randomUUID();
  notes.createNote({ id: noteId, title: 'start', format: 'rich', contentJson: '{"type":"doc"}', now: clock.now() });
  const viewId = randomUUID();
  const lease = leases.acquire(noteId, viewId, WC);
  if (!lease.granted) throw new Error('lease');
  const req = (over: Partial<NoteSaveRequestType> = {}): NoteSaveRequestType =>
    ({
      noteId,
      viewId,
      leaseToken: lease.leaseToken,
      baseRevision: 0,
      requestId: randomUUID(),
      format: 'rich',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello revision world' }] }] },
      ...over,
    }) as NoteSaveRequestType;
  const row = () => notes.getNoteById(noteId)!;
  const ftsHits = (q: string) =>
    t.db.prepare<[string], { rowid: number }>('SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?').all(q).length;
  const drafts = () =>
    t.db.prepare<[], { reason: string; content: string; title: string | null; base_revision: number }>(
      'SELECT reason, content, title, base_revision FROM note_drafts ORDER BY created_at, rowid',
    ).all();
  return { t, clock, ids, revisions, leases, writer, noteId, viewId, lease, req, row, ftsHits, drafts };
}

function catchApp(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected AppError');
}

describe('note save revision (INF-FND-13)', () => {
  it('saves at base 0, bumps the revision, sets plain_text and updates fts', async () => {
    const s = await setup();
    const request = s.req({ title: 'Greeting' });
    const ack = s.writer.save(request, { webContentsId: WC });
    expect(ack).toEqual({ noteId: s.noteId, revision: 1, requestId: request.requestId, updatedAt: s.clock.now() });
    const row = s.row();
    expect(row.revision).toBe(1);
    expect(row.title).toBe('Greeting');
    expect(row.plain_text).toBe('hello revision world');
    expect(row.content_text).toBeNull();
    expect(JSON.parse(row.content_json!).type).toBe('doc');
    expect(s.ftsHits('revision')).toBe(1);
    expect(s.revisions).toEqual([{ noteId: s.noteId, revision: 1, sourceViewId: s.viewId }]);
  });

  it('a stale base gives CONFLICT, keeps content and stores the submitted draft', async () => {
    const s = await setup();
    s.writer.save(s.req(), { webContentsId: WC });
    const stale = s.req({
      baseRevision: 0,
      title: 'Mine',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'my unsaved words' }] }] },
    });
    const err = catchApp(() => s.writer.save(stale, { webContentsId: WC }));
    expect(err.code).toBe('CONFLICT');
    expect(err.details).toMatchObject({ currentRevision: 1, reason: 'stale' });
    expect(s.row().revision).toBe(1);
    expect(s.row().plain_text).toBe('hello revision world');
    const drafts = s.drafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ reason: 'conflict', title: 'Mine', base_revision: 0 });
    expect(drafts[0]!.content).toContain('my unsaved words');
    expect(s.revisions).toHaveLength(1);
  });

  it('a duplicate requestId returns the identical ack with one write and one event', async () => {
    const s = await setup();
    const request = s.req();
    const a = s.writer.save(request, { webContentsId: WC });
    const b = s.writer.save(request, { webContentsId: WC });
    expect(b).toEqual(a);
    expect(s.row().revision).toBe(1);
    expect(s.revisions).toHaveLength(1);
  });

  it('a save to a trashed note gives CONFLICT trashed plus a draft', async () => {
    const s = await setup();
    s.t.db.prepare<[string]>('UPDATE notes SET deleted_at = 5 WHERE id = ?').run(s.noteId);
    const err = catchApp(() => s.writer.save(s.req(), { webContentsId: WC }));
    expect(err.code).toBe('CONFLICT');
    expect(err.details).toMatchObject({ reason: 'trashed' });
    expect(s.drafts()).toHaveLength(1);
    expect(s.revisions).toHaveLength(0);
  });

  it('an over-limit save gives LIMIT_EXCEEDED and writes nothing', async () => {
    const s = await setup();
    const big = s.req({ format: 'rich', content: { type: 'doc', content: ['x'.repeat(MAX_CONTENT_BYTES + 1)] } });
    expect(catchApp(() => s.writer.save(big, { webContentsId: WC })).code).toBe('LIMIT_EXCEEDED');
    expect(s.row().revision).toBe(0);
    expect(s.drafts()).toHaveLength(0);
    expect(s.revisions).toHaveLength(0);
  });

  it('a failing statement gives INTERNAL and leaves revision and content unchanged', async () => {
    const s = await setup();
    s.t.db.exec("CREATE TEMP TRIGGER boom BEFORE UPDATE ON notes WHEN NEW.title = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    const err = catchApp(() => s.writer.save(s.req({ title: 'boom' }), { webContentsId: WC }));
    expect(err.code).toBe('INTERNAL');
    expect(err.message).not.toContain('boom');
    expect(s.row().revision).toBe(0);
    expect(s.row().title).toBe('start');
    expect(s.revisions).toHaveLength(0);
  });

  it('saves plain notes into content_text and clears content_json', async () => {
    const s = await setup();
    const id = randomUUID();
    new NotesRepo(s.t.db).createNote({ id, format: 'plain', contentText: '', now: 1 });
    const view = randomUUID();
    const lease = s.leases.acquire(id, view, WC);
    if (!lease.granted) throw new Error('lease');
    s.writer.save(
      { noteId: id, viewId: view, leaseToken: lease.leaseToken, baseRevision: 0, requestId: randomUUID(), format: 'plain', content: 'line1\r\nপ্লেইন' },
      { webContentsId: WC },
    );
    const row = new NotesRepo(s.t.db).getNoteById(id)!;
    expect(row.content_json).toBeNull();
    expect(row.content_text).toBe('line1\r\nপ্লেইন');
    expect(row.plain_text).toBe('line1\nপ্লেইন');
  });

  it('retried conflict reuses the draft (F-01-3)', async () => {
    const s = await setup();
    s.writer.save(s.req(), { webContentsId: WC });
    const stale = s.req({ baseRevision: 0, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'retry me' }] }] } });
    const first = catchApp(() => s.writer.save(stale, { webContentsId: WC }));
    const second = catchApp(() => s.writer.save(stale, { webContentsId: WC }));
    expect(first.code).toBe('CONFLICT');
    expect(second.code).toBe('CONFLICT');
    expect(second.details).toEqual(first.details);
    expect(s.drafts()).toHaveLength(1);
    // a new requestId with the same stale content is a new attempt and keeps its own draft
    catchApp(() => s.writer.save({ ...stale, requestId: randomUUID() }, { webContentsId: WC }));
    expect(s.drafts()).toHaveLength(2);
  });

  it('retried trashed conflict reuses the draft (F-01-3)', async () => {
    const s = await setup();
    s.t.db.prepare<[string]>('UPDATE notes SET deleted_at = 5 WHERE id = ?').run(s.noteId);
    const request = s.req();
    const first = catchApp(() => s.writer.save(request, { webContentsId: WC }));
    const second = catchApp(() => s.writer.save(request, { webContentsId: WC }));
    expect(second.details).toEqual(first.details);
    expect(first.details).toMatchObject({ reason: 'trashed', draftId: expect.any(String) });
    expect(s.drafts()).toHaveLength(1);
  });

  it('retried lease-lost reuses the draft (F-01-3)', async () => {
    const s = await setup();
    s.leases.release(s.noteId, s.viewId, s.lease.leaseToken, WC);
    const request = s.req();
    const first = catchApp(() => s.writer.save(request, { webContentsId: WC }));
    const second = catchApp(() => s.writer.save(request, { webContentsId: WC }));
    expect(first.code).toBe('LEASE_REQUIRED');
    expect(second.code).toBe('LEASE_REQUIRED');
    expect(second.details).toEqual(first.details);
    expect(s.drafts()).toEqual([expect.objectContaining({ reason: 'lease_lost' })]);
  });

  it('a missing note gives NOT_FOUND', async () => {
    const s = await setup();
    const ghost = randomUUID();
    const view = randomUUID();
    const lease = s.leases.acquire(ghost, view, WC);
    if (!lease.granted) throw new Error('lease');
    const err = catchApp(() =>
      s.writer.save(s.req({ noteId: ghost, viewId: view, leaseToken: lease.leaseToken }), { webContentsId: WC }),
    );
    expect(err.code).toBe('NOT_FOUND');
  });
});
