import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { textToDoc } from '../../src/shared/text/textarea-doc';
import { thrown } from './hierarchy-helpers';
import { setupServices } from './hierarchy-helpers';

describe('note create, open and save (INF-TABS-03, INF-HIER-04)', () => {
  it('creates revision 0 with the empty paragraph document and opens it', async () => {
    const s = await setupServices();
    const p = s.project('P');
    const n = s.note(p.id, null, 'T');
    expect(n.revision).toBe(0);
    const opened = s.reader.open(n.id);
    expect(opened).toMatchObject({ format: 'rich', revision: 0, content: { type: 'doc', content: [{ type: 'paragraph' }] } });
    expect(opened.note).toMatchObject({ id: n.id, title: 'T', path: ['P'], sticky: false });
  });

  it('saves a textToDoc document with a lease: revision 1 and plain_text; rename keeps it; next save keeps the title', async () => {
    const s = await setupServices();
    const n = s.note(null, null, 'Title');
    const viewId = randomUUID();
    const lease = s.leases.acquire(n.id, viewId, 1);
    if (!lease.granted) throw new Error('lease');
    const save = (base: number, text: string) =>
      s.writer.save(
        { noteId: n.id, viewId, leaseToken: lease.leaseToken, baseRevision: base, requestId: randomUUID(), format: 'rich', content: textToDoc(text) },
        { webContentsId: 1 },
      );
    const ack = save(0, 'hello\nworld');
    expect(ack.revision).toBe(1);
    expect(s.row<{ plain_text: string; revision: number }>('SELECT plain_text, revision FROM notes WHERE id = ?', n.id)).toMatchObject({ revision: 1 });
    expect(s.row<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', n.id)?.plain_text).toContain('hello');
    s.tick();
    s.hierarchy.renameNote(n.id, 'New title');
    expect(s.row<{ revision: number }>('SELECT revision FROM notes WHERE id = ?', n.id)?.revision).toBe(1);
    expect(save(1, 'again').revision).toBe(2);
    expect(s.row<{ title: string }>('SELECT title FROM notes WHERE id = ?', n.id)?.title).toBe('New title');
    const reopened = s.reader.open(n.id);
    expect(reopened.revision).toBe(2);
    expect(JSON.stringify(reopened.content)).toContain('again');
  });

  it('a trashed note gives NOT_FOUND with trashed details', async () => {
    const s = await setupServices();
    const n = s.note(null, null, 'T');
    const r = s.trash.trashNote(n.id);
    const err = thrown(() => s.reader.open(n.id));
    expect(err).toEqual({ code: 'NOT_FOUND', message: 'This note is in Trash', details: { trashed: true, trashBatchId: r.trashBatchId } });
    expect(thrown(() => s.reader.open(randomUUID()))).toMatchObject({ code: 'NOT_FOUND', message: 'That item no longer exists.' });
  });

  it('after lease release a save gives LEASE_REQUIRED and stores a draft', async () => {
    const s = await setupServices();
    const n = s.note(null, null, 'T');
    const viewId = randomUUID();
    const lease = s.leases.acquire(n.id, viewId, 1);
    if (!lease.granted) throw new Error('lease');
    expect(s.leases.release(n.id, viewId, lease.leaseToken, 1)).toEqual({ released: true });
    const err = thrown(() =>
      s.writer.save(
        { noteId: n.id, viewId, leaseToken: lease.leaseToken, baseRevision: 0, requestId: randomUUID(), format: 'rich', content: textToDoc('x') },
        { webContentsId: 1 },
      ),
    );
    expect(err.code).toBe('LEASE_REQUIRED');
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM note_drafts WHERE note_id = ?', n.id)?.n).toBe(1);
  });
});
