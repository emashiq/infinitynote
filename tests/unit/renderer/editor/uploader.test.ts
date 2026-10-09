// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { kindOfFile } from '../../../../src/renderer/editor/file-sources';
import { altFromName } from '../../../../src/renderer/editor/uploader';
import { fail, ok, type Result } from '../../../../src/shared/contracts/envelope';
import type { AttachmentDtoType } from '../../../../src/shared/contracts/attachments';
import { makeEditor, tick } from './support';

type ImportResult = Result<{ attachment: AttachmentDtoType }>;

/** An importBytes double whose calls resolve only when the test says so. */
function controlledImports() {
  const calls: Array<{ kind: string; name?: string; size: number; resolve: (r: ImportResult) => void }> = [];
  const importBytes = (req: { kind: 'image' | 'document'; originalName?: string; bytes: Uint8Array }) =>
    new Promise<ImportResult>((resolve) => calls.push({ kind: req.kind, name: req.originalName, size: req.bytes.byteLength, resolve }));
  const dto = (kind: 'image' | 'document', size: number): AttachmentDtoType => ({
    id: crypto.randomUUID(),
    kind,
    mime: kind === 'image' ? 'image/png' : 'application/pdf',
    sizeBytes: size,
    originalName: null,
    width: kind === 'image' ? 10 : null,
    height: kind === 'image' ? 5 : null,
  });
  return { calls, importBytes, dto };
}

function fileOf(name: string, type: string, size = 8): File & { reads: number } {
  const file = new File([new Uint8Array(size)], name, { type }) as File & { reads: number };
  file.reads = 0;
  const read = file.arrayBuffer.bind(file);
  file.arrayBuffer = () => {
    file.reads += 1;
    return read();
  };
  return file;
}

const nodes = (editor: ReturnType<typeof makeEditor>['editor']) =>
  (editor.getJSON().content ?? []).filter((n) => n.type === 'image' || n.type === 'fileAttachment').map((n) => n.attrs!);

describe('AttachmentUploader (INF-EDIT-08..10, INF-TABS-07)', () => {
  it('bounded queue: two imports at a time, bytes read only when a job starts', async () => {
    const io = controlledImports();
    const { editor, uploader } = makeEditor({ content: '<p></p>', uploader: { importBytes: io.importBytes } });
    await tick();
    const files = [fileOf('a.png', 'image/png'), fileOf('b.png', 'image/png'), fileOf('c.pdf', 'application/pdf'), fileOf('d.png', 'image/png')];
    uploader.insertFiles(files, { from: 1, to: 1 });
    await tick();
    expect(nodes(editor)).toHaveLength(4);
    expect(nodes(editor).every((a) => typeof a.uploadToken === 'string')).toBe(true);
    expect(io.calls).toHaveLength(2);
    expect(files.map((f) => f.reads)).toEqual([1, 1, 0, 0]);
    expect(uploader.pending()).toBe(4);

    io.calls[0]!.resolve(ok({ attachment: io.dto('image', 8) }));
    await tick();
    await tick();
    expect(io.calls).toHaveLength(3);
    expect(files[2]!.reads).toBe(1);
    expect(io.calls[2]).toMatchObject({ kind: 'document', name: 'c.pdf' });
    for (const c of io.calls.slice(1)) c.resolve(ok({ attachment: io.dto(c.kind as 'image' | 'document', c.size) }));
    await tick();
    await tick();
    io.calls[3]!.resolve(ok({ attachment: io.dto('image', 8) }));
    expect(await uploader.waitIdle(1000)).toBe(true);
    expect(uploader.pending()).toBe(0);
    const done = nodes(editor);
    expect(done.every((a) => a.uploadToken === null && typeof a.attachmentId === 'string')).toBe(true);
    expect(done[0]).toMatchObject({ alt: 'a', width: 10, height: 5, size: 'medium' });
    expect(done[2]).toMatchObject({ name: 'c.pdf', mime: 'application/pdf' });
  });

  it('completion is saved but not an undo step; undo removes the image and redo brings it back finished', async () => {
    const io = controlledImports();
    const { editor, uploader, updates } = makeEditor({ content: '<p>text</p>', uploader: { importBytes: io.importBytes } });
    await tick();
    uploader.insertFiles([fileOf('photo.png', 'image/png')], { from: 1, to: 1 });
    await tick();
    io.calls[0]!.resolve(ok({ attachment: io.dto('image', 8) }));
    await uploader.waitIdle(1000);
    const completion = updates.at(-1)!;
    expect(completion.getMeta('addToHistory')).toBe(false);
    expect(completion.getMeta('infinity:persist')).toBe(true);
    const id = nodes(editor)[0]!.attachmentId;
    editor.commands.undo();
    expect(nodes(editor)).toEqual([]);
    editor.commands.redo();
    expect(nodes(editor)).toEqual([expect.objectContaining({ attachmentId: id, uploadToken: null })]);
  });

  it('a failed import removes its node and shows the message from main', async () => {
    const io = controlledImports();
    const { editor, uploader, notices } = makeEditor({ content: '<p></p>', uploader: { importBytes: io.importBytes } });
    await tick();
    uploader.insertFiles([fileOf('vector.svg', 'image/svg+xml')], { from: 1, to: 1 });
    await tick();
    io.calls[0]!.resolve(fail('UNSUPPORTED', 'This image type is not supported. Use PNG, JPEG, GIF or WebP.'));
    await uploader.waitIdle(1000);
    expect(nodes(editor)).toEqual([]);
    expect(notices).toEqual(['This image type is not supported. Use PNG, JPEG, GIF or WebP.']);
  });

  it('a file over the limit is refused before reading and nothing is inserted', async () => {
    const io = controlledImports();
    const { editor, uploader, notices } = makeEditor({ content: '<p></p>', uploader: { importBytes: io.importBytes, prefs: () => ({ imageMaxMb: 1, documentMaxMb: 2, addFiles: 'ask' }) } });
    await tick();
    const big = fileOf('big.png', 'image/png', 1024 * 1024 + 1);
    const bigDoc = fileOf('big.pdf', 'application/pdf', 2 * 1024 * 1024 + 1);
    uploader.insertFiles([big, bigDoc], { from: 1, to: 1 });
    await tick();
    expect(nodes(editor)).toEqual([]);
    expect(big.reads + bigDoc.reads).toBe(0);
    expect(io.calls).toHaveLength(0);
    expect(notices).toEqual(['This image is larger than 1 MB. Change the limit in Settings or use a smaller image.', 'This file is larger than 2 MB, so it is not copied into Infinity Notes. Link to the original instead.']);
  });

  it('at most 20 files per action', async () => {
    const { editor, uploader, notices } = makeEditor({ content: '<p></p>' });
    await tick();
    uploader.insertFiles(Array.from({ length: 22 }, (_, i) => fileOf(`f${i}.png`, 'image/png')), { from: 1, to: 1 });
    expect(nodes(editor)).toHaveLength(20);
    expect(notices).toEqual(['Only the first 20 files were added.']);
    await uploader.waitIdle(5000);
  });

  it('a node deleted before its import finishes stays deleted; waitIdle times out while work is pending', async () => {
    const io = controlledImports();
    const { editor, uploader } = makeEditor({ content: '<p>x</p>', uploader: { importBytes: io.importBytes } });
    await tick();
    uploader.insertFiles([fileOf('a.png', 'image/png')], { from: 1, to: 1 });
    await tick();
    expect(await uploader.waitIdle(20)).toBe(false);
    editor.commands.setContent('<p>replaced</p>');
    io.calls[0]!.resolve(ok({ attachment: io.dto('image', 8) }));
    expect(await uploader.waitIdle(1000)).toBe(true);
    expect(nodes(editor)).toEqual([]);
  });

  it('leaves a text cursor after inserted blocks, so typing never replaces the image', async () => {
    const { editor, uploader } = makeEditor({ content: '<p>only</p>' });
    await tick();
    const end = editor.state.doc.content.size;
    uploader.insertFiles([fileOf('a.png', 'image/png')], { from: end, to: end });
    expect(editor.state.selection.constructor.name).toBe('TextSelection');
    editor.commands.insertContent('typed after');
    const types = (editor.getJSON().content ?? []).map((n) => n.type);
    expect(types).toEqual(['paragraph', 'image', 'paragraph']);
    expect(editor.getText({ blockSeparator: '|' })).toBe('only||typed after');
    await uploader.waitIdle(1000);
  });

  it('kinds and alt text', () => {
    expect(kindOfFile({ type: 'image/png' })).toBe('image');
    expect(kindOfFile({ type: 'image/svg+xml' })).toBe('image');
    expect(kindOfFile({ type: 'application/pdf' })).toBe('document');
    expect(kindOfFile({ type: '' })).toBe('document');
    expect(altFromName('image.png')).toBe('Pasted image');
    expect(altFromName('Holiday photo.jpeg')).toBe('Holiday photo');
    expect(altFromName('')).toBe('Pasted image');
  });
});
