import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NoteConvertRequest, type ContentOpBaseType } from '../../src/shared/contracts/notes';
import { makePng } from '../support/png';
import { setupServices, thrown } from './hierarchy-helpers';

async function setup(format: 'rich' | 'plain' = 'rich') {
  const s = await setupServices();
  const note = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Formats', format).note;
  const viewId = randomUUID();
  const op = (baseRevision: number): ContentOpBaseType => ({ noteId: note.id, viewId, baseRevision, requestId: randomUUID() });
  const noteRow = () =>
    s.row<{ format: string; content_json: string | null; content_text: string | null; plain_text: string; revision: number; title: string }>(
      'SELECT format, content_json, content_text, plain_text, revision, title FROM notes WHERE id = ?',
      note.id,
    )!;
  return { ...s, note, viewId, op, noteRow };
}

describe('plain-text notes (INF-EDIT-04)', () => {
  it('plain note: created empty, saved as a string, opened as a string', async () => {
    const s = await setup('plain');
    expect(s.noteRow()).toMatchObject({ format: 'plain', content_text: '', content_json: null, plain_text: '' });
    s.writer.save({ ...s.op(0), format: 'plain', content: 'first line\nদ্বিতীয় লাইন' });
    expect(s.noteRow()).toMatchObject({ format: 'plain', content_text: 'first line\nদ্বিতীয় লাইন', content_json: null, plain_text: 'first line\nদ্বিতীয় লাইন' });
    expect(s.reader.open(s.note.id)).toMatchObject({ format: 'plain', content: 'first line\nদ্বিতীয় লাইন', revision: 1 });
  });

  it('a rich save to a plain note is refused', async () => {
    const s = await setup('plain');
    const err = thrown(() => s.writer.save({ ...s.op(0), format: 'rich', content: { type: 'doc' } }));
    expect(err.code).toBe('VALIDATION_FAILED');
  });
});

describe('format conversion (INF-EDIT-05)', () => {
  async function richWithImage() {
    const s = await setup('rich');
    const { attachment } = await s.attachments.importBytes({ kind: 'image', bytes: makePng(8, 8) });
    const [p1, h1, img] = [randomUUID(), randomUUID(), randomUUID()];
    const doc = {
      type: 'doc' as const,
      content: [
        { type: 'heading', attrs: { id: h1, level: 1 }, content: [{ type: 'text', text: 'Plan' }] },
        {
          type: 'paragraph',
          attrs: { id: p1 },
          content: [
            { type: 'text', text: 'see ' },
            { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://example.com/docs' } }] },
          ],
        },
        { type: 'image', attrs: { id: img, attachmentId: attachment.id, alt: 'chart', size: 'medium', width: 8, height: 8 } },
      ],
    };
    s.writer.save({ ...s.op(0), format: 'rich', content: doc });
    return { s, doc, attachmentId: attachment.id };
  }

  it('version created: rich to plain needs confirmation, keeps a conversion version and restores it exactly', async () => {
    const { s, doc, attachmentId } = await richWithImage();
    const priorJson = s.noteRow().content_json;
    expect(NoteConvertRequest.safeParse({ ...s.op(1), targetFormat: 'plain' }).success).toBe(false);

    s.clock.advance(1000);
    const converted = s.formats.convert({ ...s.op(1), targetFormat: 'plain', confirmLossy: true });
    expect(converted).toMatchObject({ noteId: s.note.id, revision: 2, format: 'plain', content: 'Plan\nsee docs' });
    expect(s.noteRow()).toMatchObject({ format: 'plain', content_text: 'Plan\nsee docs', content_json: null, revision: 2 });
    const version = s.row<{ id: string; reason: string; format: string; content_snapshot: string; attachment_ids: string; revision: number }>(
      'SELECT id, reason, format, content_snapshot, attachment_ids, revision FROM note_versions WHERE note_id = ?',
      s.note.id,
    )!;
    expect(version).toMatchObject({ id: converted.versionId, reason: 'conversion', format: 'rich', revision: 1 });
    expect(version.content_snapshot).toBe(priorJson);
    expect(JSON.parse(version.attachment_ids)).toEqual([attachmentId]);
    expect(s.rows('SELECT * FROM note_attachments WHERE note_id = ?', s.note.id)).toEqual([]);
    expect(s.revisions.at(-1)).toEqual({ noteId: s.note.id, revision: 2, sourceViewId: s.viewId });

    s.clock.advance(1000);
    const restored = s.versions.restore({ ...s.op(2), versionId: converted.versionId! });
    expect(restored).toMatchObject({ revision: 3, format: 'rich', content: doc });
    expect(JSON.parse(s.noteRow().content_json!)).toEqual(doc);
    expect(s.rows<{ attachment_id: string }>('SELECT attachment_id FROM note_attachments WHERE note_id = ?', s.note.id)).toEqual([{ attachment_id: attachmentId }]);
    const restoreVersion = s.row<{ reason: string; format: string; content_snapshot: string }>(
      'SELECT reason, format, content_snapshot FROM note_versions WHERE id = ?',
      restored.versionId,
    );
    expect(restoreVersion).toEqual({ reason: 'restore', format: 'plain', content_snapshot: 'Plan\nsee docs' });
  });

  it('plain to rich persists block ids; same format, stale base and missing lease are refused', async () => {
    const s = await setup('plain');
    s.writer.save({ ...s.op(0), format: 'plain', content: 'one\n\ntwo' });
    expect(thrown(() => s.formats.convert({ ...s.op(1), targetFormat: 'plain', confirmLossy: true })).code).toBe('VALIDATION_FAILED');
    expect(thrown(() => s.formats.convert({ ...s.op(0), targetFormat: 'rich' }))).toMatchObject({
      code: 'CONFLICT',
      details: { currentRevision: 1, reason: 'stale' },
    });
    expect(s.rows('SELECT id FROM note_drafts')).toEqual([]);

    const converted = s.formats.convert({ ...s.op(1), targetFormat: 'rich' });
    const doc = JSON.parse(s.noteRow().content_json!) as { content: Array<{ attrs: { id: string } }> };
    expect(doc.content).toHaveLength(3);
    expect(new Set(doc.content.map((p) => p.attrs.id)).size).toBe(3);
    expect(converted.content).toEqual(doc);
    expect(s.noteRow()).toMatchObject({ format: 'rich', content_text: null, plain_text: 'one\n\ntwo' });
  });

  it('a retried conversion request returns the same result without converting twice', async () => {
    const s = await setup('plain');
    const req = { ...s.op(0), targetFormat: 'rich' as const };
    const first = s.formats.convert(req);
    const second = s.formats.convert(req);
    expect(second).toEqual(first);
    expect(s.rows('SELECT id FROM note_versions')).toHaveLength(1);
  });

  it('a trashed note is NOT_FOUND with trashed details', async () => {
    const s = await setup('plain');
    const r = s.trash.trashNote(s.note.id);
    expect(thrown(() => s.formats.convert({ ...s.op(0), targetFormat: 'rich' }))).toMatchObject({
      code: 'NOT_FOUND',
      details: { trashed: true, trashBatchId: r.trashBatchId },
    });
  });
});
