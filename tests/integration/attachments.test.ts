import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAttachmentHandler } from '../../src/main/windows/attachment-protocol';
import { makeGif1x1, makeJpegHeader, makeWebpLossless1x1 } from '../support/images';
import { makePng } from '../support/png';
import { setupServices, type Services } from './hierarchy-helpers';
import { mkTmp } from './helpers';

const MB = 1024 * 1024;
const UNSUPPORTED = 'This image type is not supported. Use PNG, JPEG, GIF or WebP.';

/** Directory entries, or none when the directory was never created. */
const entries = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
const tmpFiles = (s: Services) => entries(path.join(s.dataDir, 'attachments', 'tmp'));
const rowCount = (s: Services) => s.rows('SELECT id FROM attachments').length;
const attachmentRow = (s: Services, id: string) =>
  s.row<{ managed_relative_path: string; sha256: string; mime: string; kind: string; size_bytes: number; original_name: string | null; unreferenced_since: number | null }>(
    'SELECT managed_relative_path, sha256, mime, kind, size_bytes, original_name, unreferenced_since FROM attachments WHERE id = ?',
    id,
  )!;

async function rejection(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (err) {
    return err as { code: string; message: string };
  }
  throw new Error('expected a rejection');
}

describe('attachment import (INF-EDIT-08, INF-EDIT-10, INF-EDIT-14)', () => {
  it('png bytes: managed copy, hashed, registered unreferenced, linked by a save', async () => {
    const s = await setupServices();
    const png = makePng(64, 48);
    const { attachment } = await s.attachments.importBytes({ kind: 'image', originalName: 'screenshot.png', bytes: png });
    expect(attachment).toMatchObject({ kind: 'image', mime: 'image/png', sizeBytes: png.length, originalName: 'screenshot.png', width: 64, height: 48 });
    const row = attachmentRow(s, attachment.id);
    expect(row.managed_relative_path).toBe(`attachments/${attachment.id.slice(0, 2)}/${attachment.id}.png`);
    expect(row.sha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect(fs.readFileSync(path.join(s.dataDir, row.managed_relative_path)).equals(png)).toBe(true);
    expect(tmpFiles(s)).toEqual([]);
    expect(row.unreferenced_since).toBe(s.clock.now());

    const note = s.note(null, null, 'With image');
    const viewId = randomUUID();
    const lease = s.leases.acquire(note.id, viewId, 1);
    if (!lease.granted) throw new Error('lease');
    const blockId = randomUUID();
    s.writer.save(
      {
        noteId: note.id,
        viewId,
        leaseToken: lease.leaseToken,
        baseRevision: 0,
        requestId: randomUUID(),
        format: 'rich',
        content: { type: 'doc', content: [{ type: 'image', attrs: { id: blockId, attachmentId: attachment.id, width: 64, height: 48 } }] },
      },
      { webContentsId: 1 },
    );
    expect(attachmentRow(s, attachment.id).unreferenced_since).toBeNull();
    expect(s.rows('SELECT note_id, attachment_id, block_id FROM note_attachments')).toEqual([{ note_id: note.id, attachment_id: attachment.id, block_id: blockId }]);
  });

  it('identical bytes reuse the row and write no second file', async () => {
    const s = await setupServices();
    const png = makePng(5, 5);
    const a = await s.attachments.importBytes({ kind: 'image', bytes: png });
    const b = await s.attachments.importBytes({ kind: 'image', originalName: 'again.png', bytes: png });
    expect(b.attachment.id).toBe(a.attachment.id);
    expect(rowCount(s)).toBe(1);
    expect(fs.readdirSync(path.join(s.dataDir, 'attachments', a.attachment.id.slice(0, 2)))).toHaveLength(1);
  });

  it('image bytes first stored as a document are promoted to an image', async () => {
    const s = await setupServices();
    const png = makePng(6, 2);
    const doc = await s.attachments.importBytes({ kind: 'document', originalName: 'picture.png', bytes: png });
    expect(doc.attachment).toMatchObject({ kind: 'document', mime: 'application/octet-stream', width: null });
    const img = await s.attachments.importBytes({ kind: 'image', bytes: png });
    expect(img.attachment).toMatchObject({ id: doc.attachment.id, kind: 'image', mime: 'image/png', width: 6, height: 2 });
    expect(attachmentRow(s, doc.attachment.id)).toMatchObject({ kind: 'image', mime: 'image/png' });
  });

  it('limits: size, configured limit, unsupported and truncated types, megapixels; nothing written', async () => {
    const s = await setupServices();
    const over = new Uint8Array(20 * MB + 1);
    over.set(makePng(1, 1));
    expect(await rejection(s.attachments.importBytes({ kind: 'image', bytes: over }))).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: 'This image is larger than 20 MB. Change the limit in Settings or use a smaller image.',
    });
    s.settings.set('attachments.imageMaxMb', 1);
    const twoMb = new Uint8Array(2 * MB);
    twoMb.set(makePng(1, 1));
    expect(await rejection(s.attachments.importBytes({ kind: 'image', bytes: twoMb }))).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: 'This image is larger than 1 MB. Change the limit in Settings or use a smaller image.',
    });
    expect(await rejection(s.attachments.importBytes({ kind: 'document', bytes: new Uint8Array(50 * MB + 1) }))).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: 'This file is larger than 50 MB. Change the limit in Settings or use a smaller file.',
    });
    const enc = (t: string) => new TextEncoder().encode(t);
    for (const bytes of [enc('<svg xmlns="http://www.w3.org/2000/svg"/>'), enc('<html><script>x</script></html>'), makePng(4, 4).subarray(0, 40)]) {
      expect(await rejection(s.attachments.importBytes({ kind: 'image', bytes }))).toEqual(expect.objectContaining({ code: 'UNSUPPORTED', message: UNSUPPORTED }));
    }
    const huge = makePng(1, 1);
    huge.writeUInt32BE(12000, 16);
    huge.writeUInt32BE(12000, 20);
    expect(await rejection(s.attachments.importBytes({ kind: 'image', bytes: huge }))).toMatchObject({
      code: 'UNSUPPORTED',
      message: 'This image is too large to display. Use an image under 100 megapixels.',
    });
    expect(rowCount(s)).toBe(0);
    expect(tmpFiles(s)).toEqual([]);
    expect(entries(path.join(s.dataDir, 'attachments')).filter((d) => d !== 'tmp')).toEqual([]);
  });

  it('GIF, JPEG and WebP are accepted with their dimensions', async () => {
    const s = await setupServices();
    const gif = await s.attachments.importBytes({ kind: 'image', bytes: makeGif1x1() });
    const jpg = await s.attachments.importBytes({ kind: 'image', bytes: makeJpegHeader(320, 240) });
    const webp = await s.attachments.importBytes({ kind: 'image', bytes: makeWebpLossless1x1() });
    expect(gif.attachment).toMatchObject({ mime: 'image/gif', width: 1, height: 1 });
    expect(jpg.attachment).toMatchObject({ mime: 'image/jpeg', width: 320, height: 240 });
    expect(webp.attachment).toMatchObject({ mime: 'image/webp', width: 1, height: 1 });
    expect(attachmentRow(s, jpg.attachment.id).managed_relative_path).toMatch(/\.jpg$/);
  });

  it('document import: name kept and sanitized, extension and MIME derived, never served by the protocol', async () => {
    const s = await setupServices();
    const pdf = await s.attachments.importBytes({ kind: 'document', originalName: 'report final.pdf', bytes: new TextEncoder().encode('%PDF-1.4 fake') });
    expect(pdf.attachment).toMatchObject({ kind: 'document', mime: 'application/pdf', originalName: 'report final.pdf', width: null, height: null });
    expect(attachmentRow(s, pdf.attachment.id).managed_relative_path).toMatch(/\.pdf$/);
    const sneaky = await s.attachments.importBytes({ kind: 'document', originalName: '..\\..\\evil/plan.docx', bytes: new TextEncoder().encode('docx') });
    expect(sneaky.attachment.originalName).toBe('plan.docx');
    const exe = await s.attachments.importBytes({ kind: 'document', originalName: 'setup.exe', bytes: new TextEncoder().encode('MZ...') });
    expect(exe.attachment).toMatchObject({ kind: 'document', mime: 'application/octet-stream' });
    expect(attachmentRow(s, exe.attachment.id).managed_relative_path).toMatch(/\.exe$/);
    const handler = createAttachmentHandler({ db: s.t.db, dataDir: s.dataDir });
    for (const id of [pdf.attachment.id, exe.attachment.id]) {
      expect((await handler(new Request(`infinity-attachment://${id}`))).status).toBe(404);
    }
  });

  it('dialog import copies: the original can be removed and the protocol still serves the managed copy', async () => {
    const s = await setupServices();
    const dir = mkTmp('infinity-originals-');
    const original = path.join(dir, 'photo.png');
    const png = makePng(10, 7);
    fs.writeFileSync(original, png);
    s.dialogQueue.push([original]);
    const res = await s.attachments.importFromDialog('image', { webContentsId: 42 });
    expect(s.dialogCalls).toEqual([{ webContentsId: 42, kind: 'image' }]);
    expect(res).toMatchObject({ canceled: false, rejected: [] });
    expect(res.imported).toEqual([expect.objectContaining({ kind: 'image', originalName: 'photo.png', width: 10, height: 7 })]);
    fs.rmSync(original);
    const handler = createAttachmentHandler({ db: s.t.db, dataDir: s.dataDir });
    const served = await handler(new Request(`infinity-attachment://${res.imported[0]!.id}`));
    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer()).equals(png)).toBe(true);
  });

  it('dialog import reports per-file problems, caps at 20 files and handles cancel', async () => {
    const s = await setupServices();
    expect(await s.attachments.importFromDialog('image', { webContentsId: 1 })).toEqual({ canceled: true, imported: [], rejected: [] });
    const dir = mkTmp('infinity-originals-');
    const files = Array.from({ length: 21 }, (_, i) => {
      const file = path.join(dir, `img${i}.png`);
      fs.writeFileSync(file, makePng(i + 1, 1));
      return file;
    });
    const svg = path.join(dir, 'drawing.svg');
    fs.writeFileSync(svg, '<svg/>');
    const big = path.join(dir, 'big.png');
    fs.writeFileSync(big, Buffer.concat([makePng(1, 1), Buffer.alloc(21 * MB)]));
    const folder = path.join(dir, 'folder.png');
    fs.mkdirSync(folder);
    s.dialogQueue.push([svg, big, folder, ...files]);
    const res = await s.attachments.importFromDialog('image', { webContentsId: 1 });
    expect(res.imported).toHaveLength(17);
    expect(res.rejected).toEqual([
      { name: 'drawing.svg', code: 'UNSUPPORTED', message: UNSUPPORTED },
      { name: 'big.png', code: 'LIMIT_EXCEEDED', message: 'This image is larger than 20 MB. Change the limit in Settings or use a smaller image.' },
      { name: 'folder.png', code: 'VALIDATION_FAILED', message: 'The image could not be added.' },
      ...files.slice(17).map((f) => ({ name: path.basename(f), code: 'LIMIT_EXCEEDED', message: 'Only the first 20 files were added.' })),
    ]);
  });

  it('sweepTmp removes leftovers older than an hour only', async () => {
    const s = await setupServices();
    const tmp = path.join(s.dataDir, 'attachments', 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const old = path.join(tmp, `${randomUUID()}.part`);
    const fresh = path.join(tmp, `${randomUUID()}.part`);
    fs.writeFileSync(old, 'x');
    fs.writeFileSync(fresh, 'y');
    const now = Date.now();
    fs.utimesSync(old, new Date(now - 2 * 3600_000), new Date(now - 2 * 3600_000));
    expect(await s.attachments.sweepTmp(now)).toBe(1);
    expect(fs.readdirSync(tmp)).toEqual([path.basename(fresh)]);
  });

  it('plain notes never link attachments', async () => {
    const s = await setupServices();
    const note = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'P', 'plain').note;
    const viewId = randomUUID();
    const lease = s.leases.acquire(note.id, viewId, 1);
    if (!lease.granted) throw new Error('lease');
    const { attachment } = await s.attachments.importBytes({ kind: 'image', bytes: makePng(2, 2) });
    s.writer.save(
      { noteId: note.id, viewId, leaseToken: lease.leaseToken, baseRevision: 0, requestId: randomUUID(), format: 'plain', content: `see ${attachment.id}` },
      { webContentsId: 1 },
    );
    expect(s.rows('SELECT * FROM note_attachments')).toEqual([]);
  });
});
