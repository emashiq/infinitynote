import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NOTE_TOO_LARGE_MESSAGE, type NoteSaveRequestType } from '../../src/shared/contracts/notes';
import { textToDoc } from '../../src/shared/text/textarea-doc';
import { makePng } from '../support/png';
import { AppError } from '../../src/main/services/app-error';
import { setupServices, thrown, type Services } from './hierarchy-helpers';

const WC = 3;

async function setup() {
  const s = await setupServices();
  const note = s.note(null, null, 'Start');
  const viewId = randomUUID();
  const lease = s.leases.acquire(note.id, viewId, WC);
  if (!lease.granted) throw new Error('lease');
  const req = (over: Partial<NoteSaveRequestType> = {}): NoteSaveRequestType =>
    ({ noteId: note.id, viewId, leaseToken: lease.leaseToken, baseRevision: 0, requestId: randomUUID(), format: 'rich', content: textToDoc('hello'), ...over }) as NoteSaveRequestType;
  const save = (over: Partial<NoteSaveRequestType> = {}) => s.writer.save(req(over), { webContentsId: WC });
  const noteRow = () =>
    s.row<{ title: string; revision: number; content_json: string; plain_text: string; updated_at: number }>(
      'SELECT title, revision, content_json, plain_text, updated_at FROM notes WHERE id = ?',
      note.id,
    )!;
  const fts = (q: string) => s.rows<{ id: string }>('SELECT n.id FROM notes_fts f JOIN notes n ON n.doc_key = f.rowid WHERE notes_fts MATCH ?', q).map((r) => r.id);
  const links = () => s.rows<{ attachment_id: string; block_id: string | null }>('SELECT attachment_id, block_id FROM note_attachments WHERE note_id = ?', note.id);
  const versions = () => s.rows<{ reason: string; revision: number }>('SELECT reason, revision FROM note_versions WHERE note_id = ? ORDER BY created_at', note.id);
  return { ...s, note, viewId, lease, req, save, noteRow, fts, links, versions };
}

async function imageDoc(s: Pick<Services, 'attachments'>, text: string) {
  const { attachment } = await s.attachments.importBytes({ kind: 'image', bytes: makePng(4, 3) });
  const blockId = randomUUID();
  const doc = {
    type: 'doc' as const,
    content: [
      { type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text }] },
      { type: 'image', attrs: { id: blockId, attachmentId: attachment.id, alt: 'chart', size: 'medium', width: 4, height: 3 } },
    ],
  };
  return { doc, attachmentId: attachment.id, blockId };
}

describe('note:save (INF-SAVE-01, INF-SAVE-02)', () => {
  it('ack: returns the new revision and emits one note:revision', async () => {
    const s = await setup();
    const request = s.req();
    const ack = s.writer.save(request, { webContentsId: WC });
    expect(ack).toEqual({ noteId: s.note.id, revision: 1, requestId: request.requestId, updatedAt: s.clock.now() });
    expect(s.revisions).toEqual([{ noteId: s.note.id, revision: 1, sourceViewId: s.viewId }]);
    expect(s.noteRow()).toMatchObject({ revision: 1, plain_text: 'hello', updated_at: s.clock.now() });
  });

  it('atomic commit: a failing link insert changes nothing; without it text, FTS, links and the auto version commit', async () => {
    const s = await setup();
    s.save({ content: textToDoc('original words') });
    s.clock.advance(1000);
    const before = s.noteRow();
    const { doc, attachmentId, blockId } = await imageDoc(s, 'replacement words');
    s.t.db.exec("CREATE TEMP TRIGGER boom BEFORE INSERT ON note_attachments BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    const err = thrown(() => s.save({ baseRevision: 1, content: doc }));
    expect(err.code).toBe('INTERNAL');
    expect(s.noteRow()).toEqual(before);
    expect(s.fts('original')).toEqual([s.note.id]);
    expect(s.fts('replacement')).toEqual([]);
    expect(s.links()).toEqual([]);
    expect(s.versions()).toEqual([]);
    expect(s.revisions).toHaveLength(1);

    s.t.db.exec('DROP TRIGGER boom');
    const ack = s.save({ baseRevision: 1, content: doc });
    expect(ack.revision).toBe(2);
    expect(s.noteRow().plain_text).toBe('replacement words');
    expect(s.fts('replacement')).toEqual([s.note.id]);
    expect(s.fts('original')).toEqual([]);
    expect(s.links()).toEqual([{ attachment_id: attachmentId, block_id: blockId }]);
    expect(s.versions()).toEqual([{ reason: 'auto', revision: 1 }]);
    expect(s.revisions.at(-1)).toEqual({ noteId: s.note.id, revision: 2, sourceViewId: s.viewId });
    expect(s.revisions).toHaveLength(2);
  });

  it('Bangla and combining text are stored byte-identical and found by FTS (INF-EDIT-12)', async () => {
    const s = await setup();
    const title = 'বাংলা নোট';
    const body = 'আমার সোনার বাংলা é 😀';
    s.save({ title, content: textToDoc(body) });
    const row = s.noteRow();
    expect(row.title).toBe(title);
    expect(Buffer.from(row.plain_text, 'utf8').equals(Buffer.from(body, 'utf8'))).toBe(true);
    expect(JSON.parse(row.content_json).content[0].content[0].text).toBe(body);
    expect(s.fts('বাংলা')).toEqual([s.note.id]);
    expect(s.reader.open(s.note.id).note.title).toBe(title);
  });

  it('normalizes the document: unknown attributes and unsafe links are dropped before storing', async () => {
    const s = await setup();
    const id = randomUUID();
    s.save({
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id, onclick: 'alert(1)' },
            content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)', target: '_blank' } }] }],
          },
        ],
      },
    });
    expect(JSON.parse(s.noteRow().content_json)).toEqual({ type: 'doc', content: [{ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text: 'click' }] }] });
  });

  it('an unknown node type is VALIDATION_FAILED and stores nothing', async () => {
    const s = await setup();
    const err = thrown(() => s.save({ content: { type: 'doc', content: [{ type: 'iframe', attrs: { src: 'https://x.example' } }] } }));
    expect(err).toEqual({ code: 'VALIDATION_FAILED', message: 'This note contains content that cannot be saved', details: undefined });
    expect(s.noteRow().revision).toBe(0);
    expect(s.rows('SELECT id FROM note_drafts')).toEqual([]);
    expect(s.revisions).toEqual([]);
  });

  it('a note over 5 MB gives the exact too-large message', async () => {
    const s = await setup();
    const err = thrown(() => s.save({ content: textToDoc('x'.repeat(5 * 1024 * 1024 + 1)) }));
    expect(err).toMatchObject({ code: 'LIMIT_EXCEEDED', message: NOTE_TOO_LARGE_MESSAGE });
    expect(s.noteRow().revision).toBe(0);
  });

  it('removing an image unlinks it and starts its unreferenced clock', async () => {
    const s = await setup();
    const { doc, attachmentId } = await imageDoc(s, 'with image');
    const attachment = () => s.row<{ unreferenced_since: number | null }>('SELECT unreferenced_since FROM attachments WHERE id = ?', attachmentId)!;
    expect(attachment().unreferenced_since).not.toBeNull();
    s.save({ content: doc });
    expect(attachment().unreferenced_since).toBeNull();
    s.clock.advance(5000);
    s.save({ baseRevision: 1, content: textToDoc('no image') });
    expect(s.links()).toEqual([]);
    expect(attachment().unreferenced_since).toBe(s.clock.now());
  });

  it('a reference to an unknown attachment keeps the node but gets no link', async () => {
    const s = await setup();
    const ghost = randomUUID();
    s.save({ content: { type: 'doc', content: [{ type: 'image', attrs: { id: randomUUID(), attachmentId: ghost } }] } });
    expect(s.noteRow().content_json).toContain(ghost);
    expect(s.links()).toEqual([]);
    expect(s.logger.lines.some((l) => l.includes('1 unknown attachment reference(s)'))).toBe(true);
  });

  it('the fault seam makes a save INTERNAL without writing (E2E failSaves)', async () => {
    let failures = 1;
    const s = await setupServices({
      testFaults: {
        save: {
          beforeSave: () => {
            if (failures > 0) {
              failures -= 1;
              throw new AppError('INTERNAL', 'injected');
            }
          },
        },
      },
    });
    const note = s.note(null, null, 'F');
    const viewId = randomUUID();
    const lease = s.leases.acquire(note.id, viewId, WC);
    if (!lease.granted) throw new Error('lease');
    const req = { noteId: note.id, viewId, leaseToken: lease.leaseToken, baseRevision: 0, requestId: randomUUID(), format: 'rich' as const, content: textToDoc('x') };
    expect(() => s.writer.save(req, { webContentsId: WC })).toThrow('injected');
    expect(s.writer.save(req, { webContentsId: WC }).revision).toBe(1);
  });
});
