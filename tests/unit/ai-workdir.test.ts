import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PreparedFile } from '../../src/main/ai/ai-context';
import { deliverFiles } from '../../src/main/ai/ai-prompt';
import { ensurePrivateRoot, removeWorkRoot, withWorkDir } from '../../src/main/ai/ai-workdir';
import { EngineError } from '../../src/main/ai/engines/engine';

const posix = process.platform !== 'win32';
const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-ai-workdir-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const note: PreparedFile = { name: 'note.txt', sizeBytes: 5, kind: 'text', mime: 'text/plain', bytes: Buffer.from('hello'), text: 'hello', extracted: false };
const mode = (p: string) => fs.statSync(p).mode & 0o777;

describe('the command-line tools’ working folders (D-195)', () => {
  it('holds only the turn’s copies while the tool runs, and is removed afterwards even when the run fails', async () => {
    const root = path.join(tmp(), 'ai-work');
    const seen = await withWorkDir(root, 'thread-1', deliverFiles([{ file: note, place: 1 }], 'cli'), async (dir) => {
      expect(dir).toBe(path.join(root, 'thread-1'));
      return fs.readdirSync(dir);
    });
    expect(seen).toEqual(['1-note.txt']);
    expect(fs.readdirSync(root)).toEqual([]);
    await expect(withWorkDir(root, 'thread-1', [], () => Promise.reject(new Error('tool failed')))).rejects.toThrow('tool failed');
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it.skipIf(!posix)('is private to the user: the root and thread folders 0700, the copies 0600, a wider root narrowed', async () => {
    const root = path.join(tmp(), 'ai-work');
    fs.mkdirSync(root, { mode: 0o777 });
    fs.chmodSync(root, 0o777);
    const modes = await withWorkDir(root, 'thread-1', deliverFiles([{ file: note, place: 1 }], 'cli'), async (dir) => ({ dir: mode(dir), file: mode(path.join(dir, '1-note.txt')) }));
    expect(modes).toEqual({ dir: 0o700, file: 0o600 });
    expect(mode(root)).toBe(0o700);
  });

  it('refuses a root another account owns, or one that is not a folder, and runs nothing there', async () => {
    const root = path.join(tmp(), 'ai-work');
    fs.mkdirSync(root);
    const other = fs.lstatSync(root).uid + 1;
    await expect(ensurePrivateRoot(root, other)).rejects.toThrow(new EngineError('The AI working folder belongs to another account, so it is not used.'));
    const file = path.join(tmp(), 'ai-work-file');
    fs.writeFileSync(file, '');
    let ran = false;
    await expect(
      withWorkDir(file, 'thread-1', [], async () => {
        ran = true;
      }),
    ).rejects.toThrow();
    expect(ran).toBe(false);
  });

  it.skipIf(!posix)('refuses a root that is a link to a folder elsewhere', async () => {
    const elsewhere = tmp();
    const root = path.join(tmp(), 'ai-work');
    fs.symlinkSync(elsewhere, root);
    await expect(ensurePrivateRoot(root)).rejects.toThrow('The AI working folder is not a folder');
  });

  it('removes everything an earlier run left at once, and is quiet when there is nothing', () => {
    const root = path.join(tmp(), 'ai-work');
    fs.mkdirSync(path.join(root, 'thread-a'), { recursive: true });
    fs.mkdirSync(path.join(root, 'thread-b'));
    fs.writeFileSync(path.join(root, 'thread-a', '1-Report.pdf'), 'secret');
    expect(removeWorkRoot(root)).toBe(2);
    expect(fs.existsSync(root)).toBe(false);
    expect(removeWorkRoot(root)).toBe(0);
  });
});
