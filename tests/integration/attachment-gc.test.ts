import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ATTACHMENT_GC_GRACE_MS } from '../../src/main/services/retention-policy';
import { makePng } from '../support/png';
import { setupServices, type Services } from './hierarchy-helpers';
import { paragraph, saveDoc } from './portability-helpers';

const imageDoc = (attachmentId: string) => ({
  type: 'doc' as const,
  content: [paragraph(randomUUID(), 'with image'), { type: 'image', attrs: { id: randomUUID(), attachmentId, alt: 'x', size: 'medium' } }],
});
const textDoc = (text: string) => ({ type: 'doc' as const, content: [paragraph(randomUUID(), text)] });

async function image(s: Services, seed: number) {
  const { attachment } = await s.attachments.importBytes({ kind: 'image', bytes: makePng(2, 2, [seed, 0, 0, 255]) });
  const file = path.join(s.dataDir, s.row<{ p: string }>('SELECT managed_relative_path AS p FROM attachments WHERE id = ?', attachment.id)!.p);
  return { id: attachment.id, file };
}

const exists = (s: Services, a: { id: string; file: string }) => s.row('SELECT id FROM attachments WHERE id = ?', a.id) !== undefined && fs.existsSync(a.file);

describe('attachment GC (INF-PORT-08)', () => {
  it('deletes only after the reference checks and the 7-day grace period', async () => {
    const s = await setupServices();
    const live = await image(s, 1);
    const trashedOnly = await image(s, 2);
    const versionOnly = await image(s, 3);
    const draftOnly = await image(s, 4);
    const orphan = await image(s, 5);

    const a = s.note(null, null, 'Live');
    saveDoc(s, a.id, imageDoc(live.id));
    const b = s.note(null, null, 'Trashed');
    saveDoc(s, b.id, imageDoc(trashedOnly.id));
    s.trash.trashNote(b.id);
    // The image is removed from the note, but an automatic version of the earlier content still has it.
    const c = s.note(null, null, 'Versioned');
    saveDoc(s, c.id, imageDoc(versionOnly.id));
    s.clock.advance(11 * 60_000);
    saveDoc(s, c.id, textDoc('image removed'));
    expect(s.rows("SELECT id FROM note_versions WHERE note_id = ? AND reason = 'auto'", c.id)).toHaveLength(1);
    // An open recovered draft uses an image no saved content has.
    s.t.db
      .prepare("INSERT INTO note_drafts(id, note_id, view_id, base_revision, format, content, reason, created_at) VALUES (?, ?, ?, 0, 'rich', ?, 'conflict', 0)")
      .run(randomUUID(), a.id, randomUUID(), JSON.stringify(imageDoc(draftOnly.id)));

    // The orphan's grace period started when it was stored and nothing used it.
    const since = s.row<{ t: number }>('SELECT unreferenced_since AS t FROM attachments WHERE id = ?', orphan.id)!.t;
    s.clock.set(since + ATTACHMENT_GC_GRACE_MS - 1);
    expect((await s.maintenance.run()).attachmentsDeleted).toBe(0);
    for (const kept of [live, trashedOnly, versionOnly, draftOnly, orphan]) expect(exists(s, kept)).toBe(true);
    s.clock.set(since + ATTACHMENT_GC_GRACE_MS);
    expect((await s.maintenance.run()).attachmentsDeleted).toBe(1);
    expect(exists(s, orphan)).toBe(false);
    for (const kept of [live, trashedOnly, versionOnly, draftOnly]) expect(exists(s, kept)).toBe(true);
  });

  it('a reference during the grace period resets the clock; purging the last user starts it', async () => {
    const s = await setupServices();
    const img = await image(s, 9);
    s.clock.advance(ATTACHMENT_GC_GRACE_MS - 10);
    const n = s.note(null, null, 'Uses it late');
    saveDoc(s, n.id, imageDoc(img.id));
    s.clock.advance(ATTACHMENT_GC_GRACE_MS);
    expect((await s.maintenance.run()).attachmentsDeleted).toBe(0);
    expect(exists(s, img)).toBe(true);

    const batch = s.trash.trashNote(n.id).trashBatchId;
    s.trash.purge({ target: { kind: 'batch', batchId: batch }, confirmed: true });
    s.clock.advance(ATTACHMENT_GC_GRACE_MS - 1);
    expect((await s.maintenance.run()).attachmentsDeleted).toBe(0);
    s.clock.advance(1);
    expect((await s.maintenance.run()).attachmentsDeleted).toBe(1);
    expect(exists(s, img)).toBe(false);
  });

  it('waits while a backup or another archive operation runs', async () => {
    const s = await setupServices();
    const img = await image(s, 7);
    s.clock.advance(ATTACHMENT_GC_GRACE_MS + 1);
    const busy = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(s.portability), 'isBusy')!;
    Object.defineProperty(s.portability, 'isBusy', { value: () => true, configurable: true });
    expect((await s.maintenance.run()).attachmentsDeleted).toBe(0);
    expect(exists(s, img)).toBe(true);
    Object.defineProperty(s.portability, 'isBusy', busy);
    expect((await s.maintenance.run()).attachmentsDeleted).toBe(1);
  });
});
