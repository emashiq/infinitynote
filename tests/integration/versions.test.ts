import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DraftsRepo } from '../../src/main/db/repositories/drafts-repo';
import { textToDoc } from '../../src/shared/text/textarea-doc';
import { AUTO_VERSION_INTERVAL_MS, AUTO_VERSION_MAX_AGE_MS, AUTO_VERSION_MAX_COUNT, DAY_MS } from '../../src/shared/versions/retention';
import { setupServices } from './hierarchy-helpers';

const MINUTE = 60_000;

async function setup() {
  const s = await setupServices();
  const note = s.note(null, null, 'Versions');
  const viewId = randomUUID();
  let revision = 0;
  const save = (text: string) => {
    revision = s.writer.save(
      { noteId: note.id, viewId, baseRevision: revision, requestId: randomUUID(), format: 'rich', content: textToDoc(text) }).revision;
  };
  const autos = () =>
    s.rows<{ revision: number; content_snapshot: string; created_at: number }>(
      "SELECT revision, content_snapshot, created_at FROM note_versions WHERE note_id = ? AND reason = 'auto' ORDER BY created_at",
      note.id,
    );
  return { ...s, note, save, autos };
}

describe('automatic versions (INF-SAVE-06, D-056)', () => {
  it('first save makes none; the next keeps the previous content; none within 10 minutes; one after', async () => {
    const s = await setup();
    s.save('one');
    expect(s.autos()).toEqual([]);
    s.clock.advance(MINUTE);
    s.save('two');
    expect(s.autos()).toHaveLength(1);
    expect(s.autos()[0]).toMatchObject({ revision: 1 });
    expect(s.autos()[0]!.content_snapshot).toContain('"one"');
    s.clock.advance(AUTO_VERSION_INTERVAL_MS - MINUTE);
    s.save('three');
    s.save('four');
    expect(s.autos()).toHaveLength(1);
    s.clock.advance(MINUTE + 1);
    s.save('five');
    expect(s.autos()).toHaveLength(2);
    expect(s.autos()[1]!.content_snapshot).toContain('"four"');
  });

  it('an empty note gets no automatic version', async () => {
    const s = await setup();
    s.save('');
    s.clock.advance(AUTO_VERSION_INTERVAL_MS + 1);
    s.save('now text');
    expect(s.autos()).toEqual([]);
  });

  it('prunes automatic versions older than 30 days and beyond 100, never other reasons', async () => {
    const s = await setup();
    s.save('base');
    const insert = s.t.db.prepare<[string, string, string, number]>(
      "INSERT INTO note_versions(id, note_id, revision, format, content_snapshot, reason, created_at) VALUES (?, ?, 1, 'rich', '{}', ?, ?)",
    );
    const now = s.clock.now();
    insert.run(randomUUID(), s.note.id, 'auto', now - AUTO_VERSION_MAX_AGE_MS - 1);
    for (let i = 0; i < AUTO_VERSION_MAX_COUNT; i += 1) insert.run(randomUUID(), s.note.id, 'auto', now - AUTO_VERSION_INTERVAL_MS - 1000 - i);
    for (const reason of ['conversion', 'conflict', 'restore']) insert.run(randomUUID(), s.note.id, reason, now - AUTO_VERSION_MAX_AGE_MS - 10);
    s.save('next');
    expect(s.autos()).toHaveLength(AUTO_VERSION_MAX_COUNT);
    expect(s.autos().every((v) => v.created_at >= now - AUTO_VERSION_MAX_AGE_MS)).toBe(true);
    expect(s.rows("SELECT reason FROM note_versions WHERE reason <> 'auto'")).toHaveLength(3);
  });

  it('lists newest first with a preview and attachment count', async () => {
    const s = await setup();
    s.save('first text');
    s.clock.advance(AUTO_VERSION_INTERVAL_MS + 1);
    s.save('second text');
    s.clock.advance(AUTO_VERSION_INTERVAL_MS + 1);
    s.save('third text');
    const { versions } = s.versions.list(s.note.id);
    expect(versions.map((v) => v.preview)).toEqual(['second text', 'first text']);
    expect(versions[0]).toMatchObject({ reason: 'auto', format: 'rich', revision: 2, attachmentCount: 0 });
    expect(versions[0]!.createdAt).toBeGreaterThan(versions[1]!.createdAt);
    expect(s.versions.list(s.note.id, 1).versions).toHaveLength(1);
    expect(() => s.versions.list(randomUUID())).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('preview is capped at 200 characters', async () => {
    const s = await setup();
    s.save('x'.repeat(500));
    s.clock.advance(AUTO_VERSION_INTERVAL_MS + 1);
    s.save('short');
    expect(s.versions.list(s.note.id).versions[0]!.preview).toHaveLength(200);
  });
});

describe('retention (INF-PORT-07, F-03-4)', () => {
  it('automatic versions follow the configured age and count, at save time and in maintenance; other reasons stay', async () => {
    const s = await setup();
    s.save('base');
    const insert = s.t.db.prepare<[string, string, string, number]>(
      "INSERT INTO note_versions(id, note_id, revision, format, content_snapshot, reason, created_at) VALUES (?, ?, 1, 'rich', '{}', ?, ?)",
    );
    const now = s.clock.now();
    for (let i = 0; i < 15; i += 1) insert.run(randomUUID(), s.note.id, 'auto', now - AUTO_VERSION_INTERVAL_MS - 1000 - i * MINUTE);
    insert.run(randomUUID(), s.note.id, 'conversion', now - 400 * DAY_MS);
    s.settings.set('retention.autoVersionMax', 10);
    s.clock.advance(AUTO_VERSION_INTERVAL_MS + 1);
    s.save('next');
    expect(s.autos()).toHaveLength(10);
    s.settings.set('retention.autoVersionDays', 1);
    s.clock.advance(DAY_MS);
    const report = await s.maintenance.run();
    expect(report.versionsPruned).toBe(9);
    expect(s.autos()).toHaveLength(1);
    expect(s.rows("SELECT reason FROM note_versions WHERE reason <> 'auto'")).toEqual([{ reason: 'conversion' }]);
  });

  it('Trash is kept by default; with 30 days only batches older than that are purged', async () => {
    const s = await setupServices();
    const old = s.note(null, null, 'Old');
    s.trash.trashNote(old.id);
    s.clock.advance(20 * DAY_MS);
    const recent = s.note(null, null, 'Recent');
    s.trash.trashNote(recent.id);
    s.clock.advance(15 * DAY_MS);
    expect((await s.maintenance.run()).trashedNotesPurged).toBe(0);
    expect(s.rows('SELECT title FROM notes WHERE deleted_at IS NOT NULL ORDER BY title')).toEqual([{ title: 'Old' }, { title: 'Recent' }]);
    s.settings.set('retention.trashDays', 30);
    expect((await s.maintenance.run()).trashedNotesPurged).toBe(1);
    expect(s.rows('SELECT title FROM notes WHERE deleted_at IS NOT NULL')).toEqual([{ title: 'Recent' }]);
    expect(s.events.at(-1)).toEqual({ reason: 'purge', trashedNoteIds: [], trashedDocumentIds: [] });
  });

  it('lease_lost drafts kept before live sync are capped at 20 open per note; resolved drafts go after 30 days', async () => {
    const s = await setupServices();
    const note = s.note(null, null, 'Drafts');
    // Earlier versions stored a draft for every save of a view that had lost the lease (live sync has none, D-103).
    const repo = new DraftsRepo(s.t.db);
    for (let i = 0; i < 25; i += 1) {
      s.clock.advance(1000);
      repo.insert({ id: randomUUID(), noteId: note.id, viewId: randomUUID(), baseRevision: 0, format: 'rich', content: JSON.stringify(textToDoc(`late ${i}`)), reason: 'lease_lost', now: s.clock.now() });
    }
    expect((await s.maintenance.run()).draftsCapped).toBe(5);
    const open = () => s.rows<{ content: string }>("SELECT content FROM note_drafts WHERE reason = 'lease_lost' AND resolved_at IS NULL ORDER BY created_at");
    expect(open()).toHaveLength(20);
    expect(open()[0]!.content).toContain('late 5');
    expect(s.drafts.list(note.id).drafts).toHaveLength(20);
    s.clock.advance(30 * DAY_MS + 1);
    expect((await s.maintenance.run()).draftsDeleted).toBe(5);
    expect(s.rows('SELECT id FROM note_drafts')).toHaveLength(20);
  });
});
