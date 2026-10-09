import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { LATEST } from '../../src/main/db/migrations';
import { ATTACHMENT_GC_GRACE_MS } from '../../src/main/services/retention-policy';
import { inspectLinkedFile, isNetworkPath, isUsableLinkPath } from '../../src/main/services/linked-file';
import { LinkedFileService } from '../../src/main/services/linked-file-service';
import type { ShellAdapter } from '../../src/main/services/shell-adapter';
import { HANDOFF_MESSAGES, LINK_MESSAGES } from '../../src/shared/contracts/attachments';
import { SearchQueryRequest } from '../../src/shared/contracts/search';
import { setupServices, type Services } from './hierarchy-helpers';
import { mkTmp } from './helpers';
import { paragraph, restartWithRestore, saveDoc, tmpFile } from './portability-helpers';

const CTX = { webContentsId: 1 };
const MB = 1024 * 1024;

async function rejection(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (err) {
    return err as { code: string; message: string };
  }
  throw new Error('expected a rejection');
}

/** Network and device paths: SMB shares, WebDAV in UNC form, forward-slash UNC, \\?\UNC and \\.\ device paths. */
const NETWORK_PATHS = [
  '\\\\attacker.example\\s\\invoice.pdf',
  '\\\\attacker.example@SSL\\DavWWWRoot\\x.pdf',
  '\\\\attacker.example@8080\\DavWWWRoot\\x.pdf',
  '//attacker.example/s/invoice.pdf',
  '\\\\?\\UNC\\attacker.example\\s\\x.pdf',
  '\\\\.\\UNC\\attacker.example\\s\\x.pdf',
];

const linkNode = (linkId: string, name: string) => ({ type: 'fileLink', attrs: { id: randomUUID(), linkId, name, sizeBytes: 5 } });

/** A folder of originals outside the app's data and a note that links some of them. */
async function setup() {
  const s = await setupServices();
  const dir = fs.realpathSync.native(mkTmp('infinity-originals-'));
  const write = (name: string, content: string | Buffer = 'hello') => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
  };
  const note = s.note(null, null, 'Project files');
  const linkInto = async (noteId: string, ...files: string[]) => {
    const links = [];
    for (const file of files) links.push(await s.links.create(file));
    saveDoc(s, noteId, { type: 'doc', content: [paragraph(randomUUID(), 'See'), ...links.map((l) => linkNode(l.id, l.name))] });
    return links;
  };
  return { s, dir, write, note, linkInto };
}

describe('linked files: migration 009 (D-108)', () => {
  it('creates linked_files and note_linked_files with their checks; deleting a note removes its usage rows only', async () => {
    const { s, write, note, linkInto } = await setup();
    expect(LATEST).toBeGreaterThanOrEqual(9);
    const [link] = await linkInto(note.id, write('report.pdf'));
    expect(s.rows('SELECT note_id, link_id FROM note_linked_files')).toEqual([{ note_id: note.id, link_id: link!.id }]);
    const insert = (id: string, p: string, name: string, size: number) =>
      s.t.db.prepare('INSERT INTO linked_files(id, path, name, size_bytes, created_at) VALUES (?, ?, ?, ?, 0)').run(id, p, name, size);
    expect(() => insert('short', '/a', 'a', 1)).toThrow(/CHECK/);
    expect(() => insert(randomUUID(), '', 'a', 1)).toThrow(/CHECK/);
    expect(() => insert(randomUUID(), 'x'.repeat(4097), 'a', 1)).toThrow(/CHECK/);
    expect(() => insert(randomUUID(), '/a', '', 1)).toThrow(/CHECK/);
    expect(() => insert(randomUUID(), '/a', 'a', -1)).toThrow(/CHECK/);
    expect(() => s.t.db.prepare('INSERT INTO note_linked_files(note_id, link_id) VALUES (?, ?)').run(note.id, randomUUID())).toThrow(/FOREIGN KEY/);
    s.t.db.prepare('DELETE FROM notes WHERE id = ?').run(note.id);
    expect(s.rows('SELECT * FROM note_linked_files')).toEqual([]);
    expect(s.rows('SELECT id FROM linked_files')).toEqual([{ id: link!.id }]);
  });
});

describe('linked files: creating and checking links (D-108)', () => {
  it('links an existing file without copying it; refuses relative, missing and folder paths', async () => {
    const { s, dir, write } = await setup();
    const file = write('Quarterly report.pdf', Buffer.alloc(3 * MB));
    const link = await s.links.create(file);
    expect(link).toEqual({ id: expect.any(String), name: 'Quarterly report.pdf', sizeBytes: 3 * MB, path: file });
    expect(s.row('SELECT path, name, size_bytes FROM linked_files WHERE id = ?', link.id)).toEqual({ path: file, name: 'Quarterly report.pdf', size_bytes: 3 * MB });
    expect(s.rows('SELECT id FROM attachments')).toEqual([]);

    expect(await rejection(s.links.create('report.pdf'))).toMatchObject({ code: 'VALIDATION_FAILED', message: LINK_MESSAGES.notFound('report.pdf') });
    const gone = path.join(dir, 'gone.pdf');
    expect(await rejection(s.links.create(gone))).toMatchObject({ code: 'NOT_FOUND', message: `File not found at ${gone}` });
    expect(await rejection(s.links.create(dir))).toMatchObject({ code: 'VALIDATION_FAILED', message: LINK_MESSAGES.notAFile });
    expect(await rejection(s.links.create(`${dir}${path.sep}..${path.sep}x.pdf`))).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('accepts only absolute, normalized paths of this system; on Windows local drives only: no network, device paths or NTFS streams', () => {
    expect(isUsableLinkPath('C:\\Users\\me\\a.pdf', 'win32')).toBe(true);
    expect(isNetworkPath('C:\\Users\\me\\a.pdf')).toBe(false);
    for (const p of [...NETWORK_PATHS, '\\\\server\\share\\a.pdf']) {
      expect(isNetworkPath(p), p).toBe(true);
      expect(isUsableLinkPath(p, 'win32'), p).toBe(false);
      expect(isUsableLinkPath(p, 'linux'), p).toBe(false);
    }
    for (const p of ['a.pdf', '\\a.pdf', 'C:a.pdf', 'C:\\Users\\..\\a.pdf', 'C:/Users/a.pdf', 'C:\\a.pdf:evil.exe', '\\\\?\\C:\\a.pdf', '\\\\.\\pipe\\x', 'C:\\a\0.pdf']) {
      expect(isUsableLinkPath(p, 'win32'), p).toBe(false);
    }
    expect(isUsableLinkPath('/home/me/a.pdf', 'linux')).toBe(true);
    for (const p of ['home/a.pdf', '/home/me/../a.pdf', '/home//a.pdf', 'C:\\Users\\a.pdf']) expect(isUsableLinkPath(p, 'linux'), p).toBe(false);
  });

  it('status: available for documents, blocked for programs, scripts, shortcuts and unknown types, missing when gone', async () => {
    const { s, write } = await setup();
    const pdf = await s.links.create(write('a.pdf'));
    expect(await s.links.status(pdf.id)).toEqual({ path: pdf.path, sizeBytes: 5, state: 'available' });
    for (const name of ['setup.exe', 'run.bat', 'run.cmd', 'x.ps1', 'x.vbs', 'x.js', 'x.msi', 'x.lnk', 'x.sh', 'x.desktop', 'x.AppImage', 'notes']) {
      const link = await s.links.create(write(name));
      expect((await s.links.status(link.id)).state, name).toBe('blocked');
    }
    fs.rmSync(pdf.path);
    expect(await s.links.status(pdf.id)).toEqual({ path: pdf.path, sizeBytes: null, state: 'missing' });
    expect(await s.links.status(randomUUID())).toEqual({ path: null, sizeBytes: null, state: 'missing' });
  });

  it.skipIf(process.platform === 'win32')('a document marked executable on Linux is blocked', async () => {
    const { write } = await setup();
    const file = write('looks-like.pdf');
    fs.chmodSync(file, 0o755);
    expect((await inspectLinkedFile(file)).state).toBe('blocked');
    fs.chmodSync(file, 0o644);
    expect((await inspectLinkedFile(file)).state).toBe('available');
  });
});

describe('linked files: network locations are never touched (D-115)', () => {
  /** Watches every file system call that could reach a host (even a stat of a UNC path makes Windows connect and authenticate). */
  function watchFs() {
    const spies = (['stat', 'lstat', 'realpath', 'access', 'open', 'readFile', 'copyFile'] as const).map((m) => vi.spyOn(fs.promises, m));
    return {
      touched: (needle: string) => spies.flatMap((spy) => spy.mock.calls.map((args) => String(args[0]))).filter((p) => p.includes(needle)),
      restore: () => spies.forEach((spy) => spy.mockRestore()),
    };
  }

  /** The service as main builds it on Windows, on any host. */
  function windowsLinks(s: Services) {
    const shellCalls: string[] = [];
    const shell: ShellAdapter = {
      openPath: async (p) => {
        shellCalls.push(`open ${p}`);
        return '';
      },
      openExternal: async () => undefined,
      showItemInFolder: (p) => {
        shellCalls.push(`show ${p}`);
      },
    };
    return { links: new LinkedFileService({ db: s.t.db, clock: s.clock, ids: s.ids, logger: s.logger, shell, attachments: s.attachments, platform: 'win32' }), shellCalls };
  }

  /** A stored link record (an older backup could hold one) used by a note. */
  function storedLink(s: Services, noteId: string, p: string): string {
    const id = randomUUID();
    s.t.db.prepare('INSERT INTO linked_files(id, path, name, size_bytes, created_at) VALUES (?, ?, ?, 5, 0)').run(id, p, 'invoice.pdf');
    saveDoc(s, noteId, { type: 'doc', content: [paragraph(randomUUID(), 'See'), linkNode(id, 'invoice.pdf')] });
    return id;
  }

  it('refuses to link a network or device path without any file system call', async () => {
    const { s, write } = await setup();
    const { links } = windowsLinks(s);
    const fsCalls = watchFs();
    try {
      for (const p of NETWORK_PATHS) expect(await rejection(links.create(p)), p).toMatchObject({ code: 'VALIDATION_FAILED', message: LINK_MESSAGES.networkLocation });
      expect(fsCalls.touched('attacker.example')).toEqual([]);
      // The watch sees real checks: linking a local file stats it.
      const local = await s.links.create(write('seen.pdf'));
      expect(fsCalls.touched('seen.pdf').length).toBeGreaterThan(0);
      expect(s.rows('SELECT id FROM linked_files')).toEqual([{ id: local.id }]);
    } finally {
      fsCalls.restore();
    }
  });

  it('a stored network path reads as missing; status, Open, Show in folder and Copy in never touch it', async () => {
    const { s, note } = await setup();
    const { links, shellCalls } = windowsLinks(s);
    const fsCalls = watchFs();
    try {
      for (const p of NETWORK_PATHS) {
        const id = storedLink(s, note.id, p);
        expect(await links.status(id), p).toEqual({ path: p, sizeBytes: null, state: 'missing' });
        for (const action of [links.open(note.id, id), links.showInFolder(note.id, id), links.copyIn(note.id, id)]) {
          expect(await rejection(action), p).toMatchObject({ code: 'NOT_FOUND' });
        }
      }
      expect(fsCalls.touched('attacker.example')).toEqual([]);
    } finally {
      fsCalls.restore();
    }
    expect(shellCalls).toEqual([]);
  });

  it('a portable import does not store link records with network paths: the chip reads as unavailable and nothing is touched', async () => {
    const { s, write, note, linkInto } = await setup();
    const [local] = await linkInto(note.id, write('spec.pdf'));
    storedLink(s, s.note(null, null, 'Invoice').id, NETWORK_PATHS[0]!);
    const file = tmpFile('crafted.infinityexport');
    s.pathQueue.push(file);
    await s.portability.exportPortable(CTX);

    const b = await setupServices();
    const fsCalls = watchFs();
    try {
      b.pathQueue.push(file);
      await b.portability.importPortable(CTX);
      expect(b.rows('SELECT path FROM linked_files')).toEqual([{ path: local!.path }]);
      const imported = b.row<{ c: string }>("SELECT content_json AS c FROM notes WHERE title = 'Invoice'")!;
      const chip = (JSON.parse(imported.c) as { content: Array<{ type: string; attrs: { linkId: string } }> }).content.find((n) => n.type === 'fileLink')!;
      expect(await b.links.status(chip.attrs.linkId)).toEqual({ path: null, sizeBytes: null, state: 'missing' });
      expect(fsCalls.touched('attacker.example')).toEqual([]);
    } finally {
      fsCalls.restore();
    }
    expect(b.logger.lines.join('\n')).toMatch(/import: portable .* refusedLinks=1/);
  });
});

describe('linked files: open, show in folder, copy in (D-108)', () => {
  it('opens a linked document by its stored path for a note that uses it; shows it in its folder', async () => {
    const { s, write, note, linkInto } = await setup();
    const [link] = await linkInto(note.id, write('plan.docx'));
    expect(await s.links.open(note.id, link!.id)).toEqual({ opened: true });
    expect(await s.links.showInFolder(note.id, link!.id)).toEqual({ shown: true });
    expect(s.shellCalls).toEqual([
      { op: 'openPath', target: link!.path },
      { op: 'showItemInFolder', target: link!.path },
    ]);
  });

  it('never launches a program: open is refused, Show in folder works', async () => {
    const { s, write, note, linkInto } = await setup();
    const [exe] = await linkInto(note.id, write('installer.exe', 'MZ'));
    expect(await rejection(s.links.open(note.id, exe!.id))).toMatchObject({ code: 'FORBIDDEN', message: HANDOFF_MESSAGES.blocked });
    expect(s.shellCalls).toEqual([]);
    await s.links.showInFolder(note.id, exe!.id);
    expect(s.shellCalls).toEqual([{ op: 'showItemInFolder', target: exe!.path }]);
  });

  it('refuses a note that does not use the link, a missing file, and reports an OS failure', async () => {
    const { s, write, note, linkInto } = await setup();
    const [link] = await linkInto(note.id, write('plan.pdf'));
    const other = s.note(null, null, 'Other');
    expect(await rejection(s.links.open(other.id, link!.id))).toMatchObject({ code: 'NOT_FOUND', message: LINK_MESSAGES.unavailable });
    s.shellResult.error = 'No application is associated';
    expect(await rejection(s.links.open(note.id, link!.id))).toMatchObject({ code: 'UNSUPPORTED', message: HANDOFF_MESSAGES.failed });
    s.shellResult.error = '';
    fs.rmSync(link!.path);
    for (const action of [() => s.links.open(note.id, link!.id), () => s.links.showInFolder(note.id, link!.id), () => s.links.copyIn(note.id, link!.id)]) {
      expect(await rejection(action())).toMatchObject({ code: 'NOT_FOUND', message: `File not found at ${link!.path}` });
    }
    expect(s.shellCalls.filter((c) => c.op === 'showItemInFolder')).toEqual([]);
  });

  it('Copy into Infinity Notes stores the linked file within the copy limit; a larger one is refused', async () => {
    const { s, write, note, linkInto } = await setup();
    const [small, big] = await linkInto(note.id, write('notes.txt', 'some text'), write('video.mp4', Buffer.alloc(25 * MB + 1)));
    const { attachment } = await s.links.copyIn(note.id, small!.id);
    expect(attachment).toMatchObject({ kind: 'document', originalName: 'notes.txt', sizeBytes: 9, mime: 'text/plain' });
    expect(await rejection(s.links.copyIn(note.id, big!.id))).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: 'This file is larger than 25 MB, so it is not copied into Infinity Notes. Link to the original instead.',
    });
  });

  it('picked files are linked without copying, and a picked file over 25 MB cannot be copied', async () => {
    const { s, write } = await setup();
    const big = write('big.zip', Buffer.alloc(26 * MB));
    s.dialogQueue.push([big]);
    const pick = await s.picker.pick('document', CTX);
    expect(pick.files).toEqual([{ name: 'big.zip', sizeBytes: 26 * MB }]);
    expect(await rejection(s.picker.add({ pickId: pick.pickId!, index: 0, action: 'copy' }, CTX))).toMatchObject({ code: 'LIMIT_EXCEEDED' });
    s.dialogQueue.push([big]);
    const again = await s.picker.pick('document', CTX);
    expect(await s.picker.add({ pickId: again.pickId!, index: 0, action: 'link' }, CTX)).toEqual({
      type: 'link',
      link: { id: expect.any(String), name: 'big.zip', sizeBytes: 26 * MB, path: big },
    });
    expect(s.rows('SELECT id FROM attachments')).toEqual([]);
  });
});

describe('linked files in search, Markdown, exports, backups and GC (D-108)', () => {
  it('search finds a note by a linked file name; Markdown links the original with a file:// URL', async () => {
    const { s, write, note, linkInto } = await setup();
    const [link] = await linkInto(note.id, write('Budget forecast (final).xlsx'));
    const results = s.search.query(SearchQueryRequest.parse({ query: 'forecast' })).results;
    expect(results.map((r) => r.note.id)).toEqual([note.id]);
    const file = tmpFile('note.md');
    s.pathQueue.push(file);
    await s.portability.exportNote({ noteId: note.id, format: 'markdown' }, CTX);
    const url = pathToFileURL(link!.path).href.replace(/\(/g, '%28').replace(/\)/g, '%29');
    expect(fs.readFileSync(file, 'utf8')).toContain(`[Budget forecast (final).xlsx](${url})`);
  });

  it('a portable export carries the link records but not the files; the import gives them new IDs', async () => {
    const { s, write, note, linkInto } = await setup();
    const [link] = await linkInto(note.id, write('spec.pdf'));
    const file = tmpFile('notes.infinityexport');
    s.pathQueue.push(file);
    await s.portability.exportPortable(CTX);

    const b = await setupServices();
    b.pathQueue.push(file);
    await b.portability.importPortable(CTX);
    const imported = b.row<{ id: string; c: string }>("SELECT id, content_json AS c FROM notes WHERE title = 'Project files'")!;
    const node = (JSON.parse(imported.c) as { content: Array<{ type: string; attrs: { linkId: string; name: string } }> }).content.find((n) => n.type === 'fileLink')!;
    expect(node.attrs.linkId).not.toBe(link!.id);
    expect(node.attrs.name).toBe('spec.pdf');
    expect(b.rows('SELECT path, name FROM linked_files')).toEqual([{ path: link!.path, name: 'spec.pdf' }]);
    expect(b.rows('SELECT note_id, link_id FROM note_linked_files')).toEqual([{ note_id: imported.id, link_id: node.attrs.linkId }]);
    expect(b.rows('SELECT id FROM attachments')).toEqual([]);
    // On a computer without the file the chip shows it as missing.
    fs.rmSync(link!.path);
    expect(await b.links.status(node.attrs.linkId)).toEqual({ path: link!.path, sizeBytes: null, state: 'missing' });
  });

  it('a backup keeps the link records; restored without the original, the link shows the file as missing', async () => {
    const { s, write, note, linkInto } = await setup();
    const [link] = await linkInto(note.id, write('contract.pdf'));
    const file = tmpFile('notebook.infinitybackup');
    s.pathQueue.push(file);
    await s.portability.createBackup(CTX);

    const b = await setupServices();
    b.pathQueue.push(file);
    await b.portability.prepareRestore(CTX);
    await b.portability.restore();
    await new Promise((resolve) => setImmediate(resolve));
    const { services: r } = await restartWithRestore(b);
    expect(r.rows('SELECT id, path FROM linked_files')).toEqual([{ id: link!.id, path: link!.path }]);
    expect(await r.links.status(link!.id)).toMatchObject({ state: 'available' });
    fs.rmSync(link!.path);
    expect(await r.links.status(link!.id)).toEqual({ path: link!.path, sizeBytes: null, state: 'missing' });
  });

  it('maintenance deletes link records nobody used for the grace period; versions keep theirs; the file is never touched', async () => {
    const { s, write, note, linkInto } = await setup();
    const [kept, dropped] = await linkInto(note.id, write('kept.pdf'), write('dropped.pdf'));
    const orphan = await s.links.create(write('never-saved.pdf'));
    // The note now uses only `kept`; its earlier content (with `dropped`) lives on in a version.
    s.clock.advance(11 * 60_000);
    saveDoc(s, note.id, { type: 'doc', content: [linkNode(kept!.id, 'kept.pdf')] });
    const versioned = s.rows<{ content_snapshot: string }>('SELECT content_snapshot FROM note_versions WHERE note_id = ?', note.id);
    expect(versioned.some((v) => v.content_snapshot.includes(dropped!.id))).toBe(true);

    expect((await s.maintenance.run()).linkedFilesDeleted).toBe(0);
    s.clock.advance(ATTACHMENT_GC_GRACE_MS + 1);
    expect((await s.maintenance.run()).linkedFilesDeleted).toBe(1);
    expect(s.rows<{ id: string }>('SELECT id FROM linked_files ORDER BY id').map((r) => r.id).sort()).toEqual([kept!.id, dropped!.id].sort());
    expect(fs.existsSync(orphan.path)).toBe(true);

    s.t.db.prepare('DELETE FROM note_versions WHERE note_id = ?').run(note.id);
    await s.maintenance.run();
    s.clock.advance(ATTACHMENT_GC_GRACE_MS + 1);
    expect((await s.maintenance.run()).linkedFilesDeleted).toBe(1);
    expect(s.rows('SELECT id FROM linked_files')).toEqual([{ id: kept!.id }]);
  });
});

