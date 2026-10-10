import { describe, expect, it } from 'vitest';
import { stickyKey } from '../../src/main/db/repositories/window-state-repo';
import { setupServices, thrown } from './hierarchy-helpers';

const MISSING = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const noteRow = (s: Awaited<ReturnType<typeof setupServices>>, id: string) =>
  s.row<{ sticky_enabled: number; color: string | null; revision: number; updated_at: number }>(
    'SELECT sticky_enabled, color, revision, updated_at FROM notes WHERE id = ?',
    id,
  )!;

describe('StickyService (plan section 8.4)', () => {
  it('enable makes a note a yellow sticky with an open window row, never touching revision or updated_at', async () => {
    const s = await setupServices();
    const note = s.note(null, null, 'Groceries');
    const before = noteRow(s, note.id);
    s.events.length = 0;
    s.tick(1000);
    s.stickies.enable(note.id);
    expect(noteRow(s, note.id)).toEqual({ ...before, sticky_enabled: 1, color: 'yellow' });
    expect(s.stickies.state(note.id)).toMatchObject({ open: true, collapsed: false, alwaysOnTop: false, bounds: null });
    expect(s.events).toEqual([{ reason: 'sticky', trashedNoteIds: [], trashedDocumentIds: [] }]);

    // Idempotent: a second enable changes nothing visible and announces nothing.
    s.events.length = 0;
    s.stickies.enable(note.id);
    expect(noteRow(s, note.id)).toEqual({ ...before, sticky_enabled: 1, color: 'yellow' });
    expect(s.events).toEqual([]);
    expect(s.rows('SELECT key FROM window_state')).toEqual([{ key: stickyKey(note.id) }]);
  });

  it('enable keeps an existing color', async () => {
    const s = await setupServices();
    const note = s.note(null, null, 'n', true);
    s.stickies.setColor(note.id, 'violet');
    s.stickies.setOpen(note.id, false);
    s.stickies.enable(note.id);
    expect(noteRow(s, note.id).color).toBe('violet');
    expect(s.stickies.state(note.id).open).toBe(true);
  });

  it('enable refuses missing and trashed notes and stores nothing', async () => {
    const s = await setupServices();
    expect(thrown(() => s.stickies.enable(MISSING))).toEqual({ code: 'NOT_FOUND', message: 'This note no longer exists', details: undefined });
    const note = s.note(null, null, 'n');
    const { trashBatchId } = s.trash.trashNote(note.id);
    expect(thrown(() => s.stickies.enable(note.id))).toEqual({ code: 'NOT_FOUND', message: 'This note is in Trash', details: { trashed: true, trashBatchId } });
    expect(noteRow(s, note.id).sticky_enabled).toBe(0);
    expect(s.rows('SELECT key FROM window_state')).toEqual([]);
  });

  it('setColor requires a sticky and leaves revision and updated_at alone', async () => {
    const s = await setupServices();
    const plain = s.note(null, null, 'plain');
    expect(thrown(() => s.stickies.setColor(plain.id, 'blue'))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'This note is not a sticky' });
    expect(thrown(() => s.stickies.setColor(MISSING, 'blue'))).toMatchObject({ code: 'NOT_FOUND' });
    const sticky = s.note(null, null, 'sticky', true);
    const before = noteRow(s, sticky.id);
    s.events.length = 0;
    s.tick(1000);
    s.stickies.setColor(sticky.id, 'blue');
    expect(noteRow(s, sticky.id)).toEqual({ ...before, color: 'blue' });
    expect(s.events).toEqual([{ reason: 'sticky', trashedNoteIds: [], trashedDocumentIds: [] }]);
  });

  it('disable clears the flag and deletes the window state', async () => {
    const s = await setupServices();
    const note = s.note(null, null, 'n');
    s.stickies.enable(note.id);
    s.stickies.setCollapsed(note.id, true);
    s.events.length = 0;
    s.stickies.disable(note.id);
    expect(noteRow(s, note.id).sticky_enabled).toBe(0);
    expect(s.rows('SELECT key FROM window_state')).toEqual([]);
    expect(s.events).toEqual([{ reason: 'sticky', trashedNoteIds: [], trashedDocumentIds: [] }]);
  });

  it('meta gives title, color and path; a trashed note keeps its original path and batch', async () => {
    const s = await setupServices();
    const alpha = s.project('Alpha');
    const plans = s.folder(alpha.id, null, 'Plans');
    const inFolder = s.note(alpha.id, plans.id, 'In folder', true);
    const common = s.note(null, null, '', true);
    expect(s.stickies.meta(common.id)).toEqual({ title: '', color: 'yellow', textColor: null, path: ['Common'], trashed: null, locked: false });
    expect(s.stickies.meta(inFolder.id)).toEqual({ title: 'In folder', color: 'yellow', textColor: null, path: ['Alpha', 'Plans'], trashed: null, locked: false });

    const { trashBatchId } = s.trash.trashFolder(plans.id);
    expect(s.stickies.meta(inFolder.id)).toEqual({ title: 'In folder', color: 'yellow', textColor: null, path: ['Alpha', 'Plans'], trashed: { batchId: trashBatchId }, locked: false });
    s.trash.purge({ target: { kind: 'batch', batchId: trashBatchId }, confirmed: true });
    expect(s.stickies.meta(inFolder.id)).toBeNull();
  });

  it('metaMany returns every live and trashed note and skips purged ones', async () => {
    const s = await setupServices();
    const alpha = s.project('Alpha');
    const a = s.note(alpha.id, null, 'A', true);
    const b = s.note(null, null, 'B', true);
    const metas = s.stickies.metaMany([a.id, b.id, MISSING]);
    expect([...metas.keys()]).toEqual([a.id, b.id]);
    expect(metas.get(a.id)?.path).toEqual(['Alpha']);
    expect(metas.get(b.id)?.path).toEqual(['Common']);
  });

  it('window state setters patch one row; a purged note gets no row', async () => {
    const s = await setupServices();
    const note = s.note(null, null, 'n', true);
    s.stickies.saveBounds(note.id, { x: null, y: null, width: 400, height: 300 }, null);
    s.stickies.setAlwaysOnTop(note.id, true);
    s.stickies.setCollapsed(note.id, true);
    s.stickies.setOpen(note.id, true);
    expect(s.stickies.state(note.id)).toEqual({ bounds: { x: null, y: null, width: 400, height: 300 }, displayId: null, open: true, collapsed: true, alwaysOnTop: true });
    s.stickies.setOpen(MISSING, true);
    expect(s.rows('SELECT key FROM window_state')).toHaveLength(1);
  });

  it('openStickyIds closes rows of trashed and unstickied notes; closeAll closes the rest', async () => {
    const s = await setupServices();
    const a = s.note(null, null, 'a');
    const b = s.note(null, null, 'b');
    const c = s.note(null, null, 'c');
    for (const n of [a, b, c]) s.stickies.enable(n.id);
    s.trash.trashNote(b.id);
    s.t.db.prepare('UPDATE notes SET sticky_enabled = 0 WHERE id = ?').run(c.id);
    expect(s.stickies.openStickyIds()).toEqual([a.id]);
    expect(s.stickies.state(b.id).open).toBe(false);
    expect(s.stickies.state(c.id).open).toBe(false);
    s.stickies.closeAll();
    expect(s.stickies.state(a.id).open).toBe(false);
    expect(s.stickies.openStickyIds()).toEqual([]);
  });
});
