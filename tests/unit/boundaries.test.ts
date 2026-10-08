import { ESLint } from 'eslint';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: path.resolve('.'), overrideConfigFile: path.resolve('eslint.config.mjs') });

async function restricted(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.resolve(file) });
  return result!.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

describe('import boundaries', () => {
  it('the renderer cannot import electron, node built-ins, better-sqlite3 or main code', async () => {
    for (const spec of ['electron', 'node:fs', 'fs', 'fs/promises', 'path', 'child_process', 'better-sqlite3', '../main/db/driver']) {
      const messages = await restricted('src/renderer/probe.ts', `import x from '${spec}';\nexport default x;\n`);
      expect(messages.length, spec).toBeGreaterThan(0);
    }
  });

  it('the renderer may import shared contracts', async () => {
    expect(await restricted('src/renderer/probe.ts', "import type { AppInfoType } from '../shared/contracts/app';\nexport type T = AppInfoType;\n")).toEqual([]);
    expect(await restricted('src/renderer/probe.ts', "import { UUID_RE } from '../shared/contracts/ids';\nexport default UUID_RE;\n")).toEqual([]);
  });

  it('the preload cannot import zod, node built-ins or main code, but may import electron', async () => {
    for (const spec of ['zod', 'node:fs', 'better-sqlite3', '../main/index']) {
      expect((await restricted('src/preload/probe.ts', `import x from '${spec}';\nexport default x;\n`)).length, spec).toBeGreaterThan(0);
    }
    expect(await restricted('src/preload/probe.ts', "import { ipcRenderer } from 'electron';\nexport default ipcRenderer;\n")).toEqual([]);
    expect(await restricted('src/preload/probe.ts', "import { EVENT_CHANNELS } from '../shared/contracts/channel-names';\nexport default EVENT_CHANNELS;\n")).toEqual([]);
  });

  it('shared code cannot import electron, node built-ins or app layers', async () => {
    for (const spec of ['electron', 'node:path', 'better-sqlite3', '../main/app-paths', '../renderer/App']) {
      expect((await restricted('src/shared/probe.ts', `import x from '${spec}';\nexport default x;\n`)).length, spec).toBeGreaterThan(0);
    }
  });

  it('only the driver may import better-sqlite3 in main', async () => {
    expect((await restricted('src/main/services/probe.ts', "import Database from 'better-sqlite3';\nexport default Database;\n")).length).toBeGreaterThan(0);
    expect(await restricted('src/main/db/better-sqlite3-driver.ts', "import Database from 'better-sqlite3';\nexport default Database;\n")).toEqual([]);
  });

  it('one editor engine (INF-EDIT-01): no hand-made contentEditable or execCommand; only NoteEditor creates editors', async () => {
    const fs = await import('node:fs');
    const files = fs
      .readdirSync('src/renderer', { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => ({ file: f.replace(/\\/g, '/'), text: fs.readFileSync(`src/renderer/${f}`, 'utf8') }));
    expect(files.length).toBeGreaterThan(50);
    for (const { file, text } of files) {
      expect(text, file).not.toMatch(/contenteditable="true"|contentEditable=\{true\}|execCommand/);
    }
    expect(files.filter((f) => /\buseEditor\(/.test(f.text)).map((f) => f.file)).toEqual(['editor/NoteEditor.tsx']);
  });

  it('the preload surface and router expose no Phase 04 channels', async () => {
    const fs = await import('node:fs');
    const preload = fs.readFileSync('src/preload/index.ts', 'utf8');
    expect(preload).toContain("call('lease:take')");
    expect(preload).not.toMatch(/sticky:float|window:getState|note:trashed|sticky:state/);
    expect(preload).not.toMatch(/exposeInMainWorld\('(?!infinity')/);
    const ipcSources = fs
      .readdirSync('src/main/ipc', { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts'))
      .map((f) => fs.readFileSync(`src/main/ipc/${f}`, 'utf8'))
      .join('\n');
    // Positive control: the pattern below must be able to see how channels are registered.
    expect(ipcSources).toContain("router.register('note:save'");
    expect(ipcSources).not.toMatch(/'(sticky:float|window:getState|note:trashed|sticky:state)'/);
  });
});
