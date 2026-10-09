// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pickedSources } from '../../../../src/renderer/editor/file-sources';
import type { FileChoice, FileChoiceRequest, UploaderDeps } from '../../../../src/renderer/editor/uploader';
import { actionFor, canCopy, needsChoice } from '../../../../src/shared/attachments/file-choice';
import type { AddFilesMode } from '../../../../src/shared/attachments/file-choice';
import { ok } from '../../../../src/shared/contracts/envelope';
import { makeEditor, tick } from './support';

const MB = 1024 * 1024;

function fileOf(name: string, size: number, type = 'application/pdf'): File & { reads: number } {
  const file = new File([new Uint8Array(size)], name, { type }) as File & { reads: number };
  file.reads = 0;
  const read = file.arrayBuffer.bind(file);
  file.arrayBuffer = () => {
    file.reads += 1;
    return read();
  };
  return file;
}

/** An editor whose dropped files have the given paths, with recorded links, copies, questions and remembered choices. */
function setup(mode: AddFilesMode, paths: Map<File, string>, answer: FileChoice | null = null) {
  const asked: FileChoiceRequest[] = [];
  const linked: string[] = [];
  const copied: string[] = [];
  const remembered: string[] = [];
  const deps: Partial<UploaderDeps> = {
    prefs: () => ({ imageMaxMb: 20, documentMaxMb: 25, addFiles: mode }),
    isOnDisk: (file) => paths.has(file),
    linkFile: async (file) => {
      const path = paths.get(file)!;
      linked.push(path);
      return ok({ link: { id: crypto.randomUUID(), name: path.split('/').pop()!, sizeBytes: 7, path } });
    },
    importBytes: async (req) => {
      copied.push(req.originalName ?? '');
      return ok({ attachment: { id: crypto.randomUUID(), kind: req.kind, mime: 'application/pdf', sizeBytes: req.bytes.byteLength, originalName: req.originalName ?? null, width: null, height: null } });
    },
    chooseFiles: async (request) => {
      asked.push(request);
      return answer;
    },
    rememberChoice: (action) => remembered.push(action),
  };
  const t = makeEditor({ content: '<p></p>', uploader: deps });
  const chips = (): Array<Record<string, unknown>> =>
    (t.editor.getJSON().content ?? []).filter((n) => n.type === 'fileAttachment' || n.type === 'fileLink').map((n) => ({ type: n.type, ...n.attrs }));
  return { ...t, asked, linked, copied, remembered, chips };
}

async function settle(t: { uploader: { waitIdle(ms: number): Promise<boolean> } }) {
  await tick();
  await tick();
  await t.uploader.waitIdle(1000);
}

describe('copy or link (D-108): rules', () => {
  it('files up to the copy limit can be copied; the preferred action wins when the file allows it', () => {
    const small = { sizeBytes: 25 * MB, linkable: true };
    const big = { sizeBytes: 25 * MB + 1, linkable: true };
    const pasted = { sizeBytes: 10, linkable: false };
    const pastedBig = { sizeBytes: 26 * MB, linkable: false };
    expect([canCopy(small, 25), canCopy(big, 25), canCopy(big, 26)]).toEqual([true, false, true]);
    expect(actionFor(small, 'copy', 25)).toBe('copy');
    expect(actionFor(small, 'link', 25)).toBe('link');
    expect(actionFor(big, 'copy', 25)).toBe('link');
    expect(actionFor(pasted, 'link', 25)).toBe('copy');
    expect(actionFor(pastedBig, 'copy', 25)).toBeNull();
    expect(needsChoice('ask', [pasted, small])).toBe(true);
    expect(needsChoice('ask', [pasted])).toBe(false);
    expect(needsChoice('copy', [small])).toBe(false);
  });
});

describe('copy or link (D-108): the uploader', () => {
  it('Ask: one question per drop; Link to the original links every file without reading it and keeps the block ID', async () => {
    const a = fileOf('a.pdf', 10);
    const b = fileOf('b.docx', 26 * MB);
    const t = setup('ask', new Map([[a, '/docs/a.pdf'], [b, '/docs/b.docx']]), { action: 'link', remember: true });
    t.uploader.insertFiles([a, b], { from: 1, to: 1 });
    await settle(t);
    expect(t.asked).toEqual([
      {
        files: [
          { name: 'a.pdf', sizeBytes: 10, linkable: true },
          { name: 'b.docx', sizeBytes: 26 * MB, linkable: true },
        ],
        copyLimitMb: 25,
      },
    ]);
    expect(t.linked).toEqual(['/docs/a.pdf', '/docs/b.docx']);
    expect(a.reads + b.reads).toBe(0);
    expect(t.remembered).toEqual(['link']);
    const chips = t.chips();
    expect(chips).toEqual([
      expect.objectContaining({ type: 'fileLink', name: 'a.pdf', sizeBytes: 7, linkId: expect.any(String) }),
      expect.objectContaining({ type: 'fileLink', name: 'b.docx', linkId: expect.any(String) }),
    ]);
    expect(chips.every((c) => typeof c.id === 'string')).toBe(true);
  });

  it('Ask: Copy into Infinity Notes copies the small file and links the one over 25 MB, which is never read', async () => {
    const a = fileOf('a.pdf', 10);
    const b = fileOf('b.docx', 26 * MB);
    const t = setup('ask', new Map([[a, '/docs/a.pdf'], [b, '/docs/b.docx']]), { action: 'copy', remember: false });
    t.uploader.insertFiles([a, b], { from: 1, to: 1 });
    await settle(t);
    expect(t.copied).toEqual(['a.pdf']);
    expect(t.linked).toEqual(['/docs/b.docx']);
    expect(b.reads).toBe(0);
    expect(t.remembered).toEqual([]);
    expect(t.notices).toEqual([]);
    expect(t.chips().map((c) => c.type)).toEqual(['fileAttachment', 'fileLink']);
  });

  it('Ask: Cancel removes the "Adding file…" chips and adds nothing', async () => {
    const a = fileOf('a.pdf', 10);
    const t = setup('ask', new Map([[a, '/docs/a.pdf']]), null);
    t.uploader.insertFiles([a], { from: 1, to: 1 });
    await tick();
    await settle(t);
    expect(t.asked).toHaveLength(1);
    expect(t.chips()).toEqual([]);
    expect(t.copied).toEqual([]);
    expect(t.linked).toEqual([]);
    expect(t.notices).toEqual([]);
  });

  it('Always copy: no question; a file over 25 MB is linked with a notice instead of being dropped', async () => {
    const a = fileOf('a.pdf', 10);
    const b = fileOf('big.mov', 30 * MB, 'video/quicktime');
    const t = setup('copy', new Map([[a, '/docs/a.pdf'], [b, '/docs/big.mov']]));
    t.uploader.insertFiles([a, b], { from: 1, to: 1 });
    await settle(t);
    expect(t.asked).toEqual([]);
    expect(t.copied).toEqual(['a.pdf']);
    expect(t.linked).toEqual(['/docs/big.mov']);
    expect(t.notices).toEqual(['big.mov is larger than 25 MB, so it was linked to the original instead of copied.']);
  });

  it('Always link: no question; clipboard data without a path is copied, and too large clipboard data is refused', async () => {
    const onDisk = fileOf('a.pdf', 10);
    const pasted = fileOf('pasted.txt', 10, 'text/plain');
    const pastedBig = fileOf('huge.bin', 26 * MB, 'application/octet-stream');
    const t = setup('link', new Map([[onDisk, '/docs/a.pdf']]));
    t.uploader.insertFiles([onDisk, pasted, pastedBig], { from: 1, to: 1 });
    await settle(t);
    expect(t.asked).toEqual([]);
    expect(t.linked).toEqual(['/docs/a.pdf']);
    expect(t.copied).toEqual(['pasted.txt']);
    expect(pastedBig.reads).toBe(0);
    expect(t.notices).toEqual(['This file is larger than 25 MB, so it is not copied into Infinity Notes. Link to the original instead.']);
    expect(t.chips().map((c) => c.type)).toEqual(['fileLink', 'fileAttachment']);
  });

  it('Ask without any file on disk copies without asking', async () => {
    const pasted = fileOf('pasted.txt', 10, 'text/plain');
    const t = setup('ask', new Map());
    t.uploader.insertFiles([pasted], { from: 1, to: 1 });
    await settle(t);
    expect(t.asked).toEqual([]);
    expect(t.copied).toEqual(['pasted.txt']);
  });

  it('picked files are added by index with the chosen action; images are always copied', async () => {
    const calls: unknown[] = [];
    const addPicked = async (req: { pickId: string; index: number; action: 'copy' | 'link' }) => {
      calls.push(req);
      return ok({ type: 'link' as const, link: { id: crypto.randomUUID(), name: 'big.zip', sizeBytes: 30 * MB, path: '/x/big.zip' } });
    };
    const pick = { pickId: crypto.randomUUID(), files: [{ name: 'big.zip', sizeBytes: 30 * MB }] };
    const t = setup('ask', new Map(), { action: 'copy', remember: false });
    t.uploader.addFiles(pickedSources(pick, 'document', addPicked), { from: 1, to: 1 });
    await settle(t);
    expect(t.asked).toEqual([{ files: [{ name: 'big.zip', sizeBytes: 30 * MB, linkable: true }], copyLimitMb: 25 }]);
    expect(calls).toEqual([{ pickId: pick.pickId, index: 0, action: 'link' }]);
    expect(t.chips()).toEqual([expect.objectContaining({ type: 'fileLink', name: 'big.zip' })]);
    expect(pickedSources(pick, 'image', addPicked)[0]!.linkable).toBe(false);
  });
});
