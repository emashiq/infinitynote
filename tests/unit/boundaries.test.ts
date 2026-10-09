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

  it('the preload surface and router expose the Phase 07 channels and nothing outside the catalogue (D-098)', async () => {
    const fs = await import('node:fs');
    const preload = fs.readFileSync('src/preload/index.ts', 'utf8');
    expect(preload).toContain("call('sticky:float')");
    expect(preload).toContain("call('reminder:create')");
    expect(preload).toContain("call('reminder:createFromSuggestion')");
    for (const name of ['refs:list', 'notes:pick', 'search:query', 'tags:list', 'tags:set', 'attachment:open', 'attachment:showInFolder']) {
      expect(preload).toContain(`call('${name}')`);
    }
    expect(preload).not.toMatch(/note:trashed|sticky:removeSticky|attachment:importImageBytes/);
    expect(preload).not.toMatch(/exposeInMainWorld\('(?!infinity')/);
    const ipcSources = fs
      .readdirSync('src/main/ipc', { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts'))
      .map((f) => fs.readFileSync(`src/main/ipc/${f}`, 'utf8'))
      .join('\n');
    // Positive control: the pattern below must be able to see how channels are registered.
    expect(ipcSources).toContain("router.register('sticky:float'");
    expect(ipcSources).toContain("router.register('reminder:create'");
    expect(ipcSources).toContain("router.register('suggestion:listDismissed'");
    expect(ipcSources).toContain("router.register('refs:list'");
    expect(ipcSources).toContain("router.register('attachment:open'");
    expect(ipcSources).not.toMatch(/'(note:trashed|sticky:removeSticky|attachment:importImageBytes)'/);
  });

  it('no hard-coded reminder zone (INF-REM-02, D-079): no Asia/Dhaka literal, UTC only as the disclosed fallback', async () => {
    const fs = await import('node:fs');
    const sources = fs
      .readdirSync('src', { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => ({ file: f.replace(/\\/g, '/'), text: fs.readFileSync(`src/${f}`, 'utf8') }));
    const quoted = (zone: string) => new RegExp(`['"\`]${zone.replace('/', '\\/')}['"\`]`);
    expect(sources.filter((s) => quoted('UTC').test(s.text)).map((s) => s.file)).toEqual(['shared/time/zones.ts']);
    for (const { file, text } of sources) {
      // The abbreviation table names Asia/Dhaka only as the second suggestion for "BST", never as a default (D-096).
      const checked = file === 'shared/nlp/abbreviations.ts' ? text.replace(/^ {2}BST: \[\['Europe\/London'\], \['Asia\/Dhaka'\]\],$/m, '') : text;
      expect(checked, file).not.toMatch(quoted('Asia/Dhaka'));
    }
  });

  it('natural-language parsing is local and English-only (INF-NLP-01, INF-NLP-14)', async () => {
    const fs = await import('node:fs');
    const read = (dir: string) =>
      fs
        .readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .map((f) => ({ file: `${dir}/${f.replace(/\\/g, '/')}`, text: fs.readFileSync(`${dir}/${f}`, 'utf8') }));
    const chronoImports = read('src').flatMap(({ file, text }) => [...text.matchAll(/from '(chrono-node[^']*)'/g)].map((m) => `${file} ${m[1]}`));
    expect(chronoImports).toEqual(['src/shared/nlp/parse.ts chrono-node/en']);
    for (const { file, text } of read('src/main')) expect(text, file).not.toMatch(/chrono-node|nlp\/parse'/);
    const nlp = read('src/shared/nlp');
    expect(nlp.map((f) => f.file)).toEqual(expect.arrayContaining(['src/shared/nlp/parse.ts', 'src/shared/nlp/resolve-candidate.ts', 'src/shared/nlp/source-text.ts']));
    const suggestionUi = read('src/renderer').filter((f) => /suggest|card-request/i.test(f.file));
    for (const { file, text } of [...nlp, ...suggestionUi]) {
      expect(text, file).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|from '(node:)?(https?|net)'/);
    }
  });

  it('one scheduler timer (INF-SCHED-01): no per-reminder timers in the reminder modules', async () => {
    const fs = await import('node:fs');
    const files = fs.readdirSync('src/main/services').filter((f) => /^reminder-.*\.ts$/.test(f));
    expect(files).toEqual(expect.arrayContaining(['reminder-scheduler.ts', 'reminder-service.ts', 'reminder-anchors.ts']));
    const calls = files.flatMap((f) => [...fs.readFileSync(`src/main/services/${f}`, 'utf8').matchAll(/setTimeout\(|setInterval\(/g)].map(() => f));
    expect(calls).toEqual(['reminder-scheduler.ts']);
  });

  it('reminders stop when the app is fully quit (INF-SCHED-09): no OS-level timers, tasks or wake locks', async () => {
    const fs = await import('node:fs');
    const sources = fs
      .readdirSync('src', { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => ({ file: f, text: fs.readFileSync(`src/${f}`, 'utf8') }));
    for (const { file, text } of sources) expect(text, file).not.toMatch(/schtasks|systemd-run|crontab|powerSaveBlocker/);
  });

  it('no code forces an ozone platform (INF-STKY-13, D-050)', async () => {
    const fs = await import('node:fs');
    const sources = fs
      .readdirSync('src', { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => ({ file: f, text: fs.readFileSync(`src/${f}`, 'utf8') }));
    expect(sources.some((s) => s.text.includes("getSwitchValue('ozone-platform')"))).toBe(true);
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/appendSwitch\(\s*['"]ozone-platform|--ozone-platform|enable-features=UseOzonePlatform/);
    }
  });

  it('the window and sticky logic modules do not import electron at runtime (plan section 3.1)', async () => {
    const fs = await import('node:fs');
    for (const file of [
      'src/main/windows/sticky-manager.ts',
      'src/main/windows/main-window-controller.ts',
      'src/main/windows/display-clamp.ts',
      'src/main/windows/display-provider.ts',
      'src/main/services/sticky-service.ts',
      'src/main/db/repositories/window-state-repo.ts',
      'src/main/services/tray-probe.ts',
      'src/main/services/close-dialog.ts',
      'src/main/test-hooks.ts',
      'src/main/db/repositories/reminders-repo.ts',
      'src/main/services/reminder-service.ts',
      'src/main/services/reminder-model.ts',
      'src/main/services/reminder-anchors.ts',
      'src/main/services/reminder-scheduler.ts',
      'src/main/services/notification-adapter.ts',
      'src/main/services/electron-notifications.ts',
      'src/main/services/power-events.ts',
      'src/main/services/system-zone.ts',
      'src/main/services/timers.ts',
      'src/main/services/autostart.ts',
      'src/main/services/electron-autostart.ts',
      'src/main/services/widget-state.ts',
      'src/main/windows/widget-manager.ts',
    ]) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/^import (?!type )[^;]*from 'electron';/m);
    }
    // Positive control: an adapter does import it.
    expect(fs.readFileSync('src/main/windows/sticky-window.ts', 'utf8')).toMatch(/^import (?!type )[^;]*from 'electron';/m);
  });
});
