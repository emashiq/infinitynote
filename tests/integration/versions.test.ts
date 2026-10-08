import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { textToDoc } from '../../src/shared/text/textarea-doc';
import { AUTO_VERSION_INTERVAL_MS, AUTO_VERSION_MAX_AGE_MS, AUTO_VERSION_MAX_COUNT } from '../../src/shared/versions/retention';
import { setupServices } from './hierarchy-helpers';

const WC = 5;
const MINUTE = 60_000;

async function setup() {
  const s = await setupServices();
  const note = s.note(null, null, 'Versions');
  const viewId = randomUUID();
  const lease = s.leases.acquire(note.id, viewId, WC);
  if (!lease.granted) throw new Error('lease');
  let revision = 0;
  const save = (text: string) => {
    revision = s.writer.save(
      { noteId: note.id, viewId, leaseToken: lease.leaseToken, baseRevision: revision, requestId: randomUUID(), format: 'rich', content: textToDoc(text) },
      { webContentsId: WC },
    ).revision;
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
