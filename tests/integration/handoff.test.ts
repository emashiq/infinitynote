import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HANDOFF_MESSAGES } from '../../src/shared/contracts/attachments';
import { doc, setupReminders } from './reminder-helpers';

const fileNode = (attachmentId: string, name: string) => ({
  type: 'fileAttachment',
  attrs: { id: randomUUID(), attachmentId, name, sizeBytes: 5, mime: 'application/octet-stream' },
});

async function rejection(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (err) {
    return err as { code: string; message: string };
  }
  throw new Error('expected a rejection');
}

async function setup() {
  const s = await setupReminders();
  const bytes = new TextEncoder().encode('hello');
  const pdf = (await s.attachments.importBytes({ kind: 'document', originalName: 'report.pdf', bytes })).attachment;
  const exe = (await s.attachments.importBytes({ kind: 'document', originalName: 'setup.exe', bytes: new TextEncoder().encode('MZ...') })).attachment;
  const note = s.editable('Files');
  note.save(doc(fileNode(pdf.id, 'report.pdf'), fileNode(exe.id, 'setup.exe')));
  const fileOf = (id: string) => path.join(s.dataDir, s.row<{ managed_relative_path: string }>('SELECT managed_relative_path FROM attachments WHERE id = ?', id)!.managed_relative_path);
  return { s, note, pdf, exe, fileOf };
}

describe('attached document hand-off (INF-REF-08, D-098)', () => {
  it('opens a linked document through the OS with the stored path inside the attachments folder', async () => {
    const { s, note, pdf, fileOf } = await setup();
    expect(await s.handoff.open(note.note.id, pdf.id)).toEqual({ opened: true });
    expect(s.shellCalls).toEqual([{ op: 'openPath', target: fs.realpathSync(fileOf(pdf.id)) }]);
    expect(await s.handoff.showInFolder(note.note.id, pdf.id)).toEqual({ shown: true });
    expect(s.shellCalls[1]).toEqual({ op: 'showItemInFolder', target: fs.realpathSync(fileOf(pdf.id)) });
  });

  it('blocked extensions: a program is never launched, but can be shown in its folder', async () => {
    const { s, note, exe, fileOf } = await setup();
    expect(await rejection(s.handoff.open(note.note.id, exe.id))).toMatchObject({ code: 'FORBIDDEN', message: HANDOFF_MESSAGES.blocked });
    expect(s.shellCalls).toEqual([]);
    await s.handoff.showInFolder(note.note.id, exe.id);
    expect(s.shellCalls).toEqual([{ op: 'showItemInFolder', target: fs.realpathSync(fileOf(exe.id)) }]);
  });

  it('refuses a file the note does not link, a missing file and a file replaced by a link; reports an OS failure', async () => {
    const { s, note, pdf, fileOf } = await setup();
    const other = s.editable('Other');
    expect(await rejection(s.handoff.open(other.note.id, pdf.id))).toMatchObject({ code: 'NOT_FOUND', message: HANDOFF_MESSAGES.missing });

    s.shellResult.error = 'No application is associated';
    expect(await rejection(s.handoff.open(note.note.id, pdf.id))).toMatchObject({ code: 'UNSUPPORTED', message: HANDOFF_MESSAGES.failed });
    s.shellResult.error = '';

    fs.rmSync(fileOf(pdf.id));
    expect(await rejection(s.handoff.open(note.note.id, pdf.id))).toMatchObject({ code: 'NOT_FOUND', message: HANDOFF_MESSAGES.missing });

    // A directory junction (Windows, no admin needed) or symlink (Linux) under attachments/ pointing outside, in a
    // shard (the first two hex characters of an attachment ID) that no stored attachment uses.
    const outside = path.join(s.t.dir, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'leak.pdf'), 'secret');
    const used = new Set(fs.readdirSync(path.join(s.dataDir, 'attachments')));
    const shard = Array.from({ length: 256 }, (_, n) => n.toString(16).padStart(2, '0')).find((h) => !used.has(h))!;
    fs.symlinkSync(outside, path.join(s.dataDir, 'attachments', shard), process.platform === 'win32' ? 'junction' : 'dir');
    s.t.db.prepare<[string, string]>('UPDATE attachments SET managed_relative_path = ? WHERE id = ?').run(`attachments/${shard}/leak.pdf`, pdf.id);
    expect(await rejection(s.handoff.open(note.note.id, pdf.id))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await rejection(s.handoff.showInFolder(note.note.id, pdf.id))).toMatchObject({ code: 'FORBIDDEN' });
    expect(s.shellCalls.filter((c) => c.target.includes('leak'))).toEqual([]);
  });
});
