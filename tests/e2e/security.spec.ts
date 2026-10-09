import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PROD_CSP } from '../../src/shared/csp';
import { makePng } from '../support/png';
import { readMainLog, rendererSandbox } from './fixtures';
import { useApp } from './harness';
import { stickyPage } from './sticky-ui';

const h = useApp();
test.beforeEach(async () => {
  await h.start();
});

const page = () => h.page;
const app = () => h.app;

test('renderer has no node/require', async () => {
  const types = await page().evaluate(() => [typeof require, typeof process, typeof module, typeof Buffer]);
  expect(types).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
  expect(page().url().startsWith('infinity-app://renderer/')).toBe(true);
});

test('CSP enforced', async () => {
  const meta = await page().locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(meta).toBe(PROD_CSP);

  const result = await page().evaluate(async () => {
    const violations: string[] = [];
    document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective));
    const script = document.createElement('script');
    script.textContent = 'window.__inlineRan = true;';
    document.head.appendChild(script);
    // String timers are subject to the eval restriction of script-src.
    setTimeout('window.__evalRan = true', 0);
    await new Promise((r) => setTimeout(r, 300));
    const w = window as unknown as { __inlineRan?: boolean; __evalRan?: boolean };
    return { inline: w.__inlineRan === true, evaluated: w.__evalRan === true, violations };
  });
  expect(result.inline).toBe(false);
  expect(result.evaluated).toBe(false);
  expect(result.violations.length).toBeGreaterThanOrEqual(1);
});

test('navigation blocked', async () => {
  for (const target of ['https://example.com/', 'file:///']) {
    await page().evaluate((t) => {
      window.location.href = t;
    }, target);
    await page().waitForTimeout(500);
    expect(page().url().startsWith('infinity-app://renderer/'), target).toBe(true);
  }
  // The page is still the original renderer document (Playwright's locator waits stall after a cancelled navigation).
  expect(await page().evaluate(() => document.querySelector('h1')?.textContent)).toBe('Infinity Notes');
  expect(await app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.webContents.getURL())).toBe('infinity-app://renderer/index.html#/');
  expect(readMainLog(h.userData)).toContain('blocked navigation url=https://example.com');
});

test('window.open denied', async () => {
  const opened = await page().evaluate(() => window.open('https://example.com/') === null);
  expect(opened).toBe(true);
  await page().waitForTimeout(300);
  expect(app().windows().length).toBe(1);
});

test('permissions denied', async () => {
  const result = await page().evaluate(async () => ({
    notification: await Notification.requestPermission(),
    geolocation: (await navigator.permissions.query({ name: 'geolocation' })).state,
  }));
  expect(result).toEqual({ notification: 'denied', geolocation: 'denied' });
});

test('web preferences hardened', async () => {
  const prefs = await app().evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> };
    const p = wc.getLastWebPreferences();
    return {
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration,
      sandbox: p.sandbox,
      webSecurity: p.webSecurity,
      webviewTag: p.webviewTag,
      allowRunningInsecureContent: p.allowRunningInsecureContent,
    };
  });
  expect(prefs).toEqual({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    allowRunningInsecureContent: false,
  });
});

test('renderer runs inside the OS sandbox', async () => {
  // The fixture passes chromiumSandbox: true; the OS must confirm the renderer is sandboxed (fails under --no-sandbox).
  const sandbox = await rendererSandbox(app());
  console.log(`renderer sandbox: ${sandbox.evidence}`);
  expect(sandbox.osSandboxed, sandbox.evidence).toBe(true);
});

test('bridge surface', async () => {
  const surface = await page().evaluate(() => {
    const b = window.infinity as unknown as Record<string, unknown>;
    const keys = (o: unknown) => Object.keys(o as object).sort();
    let subscribeError = '';
    try {
      window.infinity.subscribe('suggestion:dismiss' as never, () => {});
    } catch (e) {
      subscribeError = (e as Error).message;
    }
    const namespaces = Object.fromEntries(
      Object.entries(b)
        .filter(([, v]) => typeof v === 'object' && v !== null)
        .map(([k, v]) => [k, keys(v)]),
    );
    const allFrozen = Object.values(b).every((v) => typeof v !== 'object' || v === null || Object.isFrozen(v));
    return {
      top: keys(b),
      namespaces,
      frozen: Object.isFrozen(b),
      allFrozen,
      subscribeType: typeof b.subscribe,
      subscribeError,
      noGeneric: ['invoke', 'send', 'on', 'ipcRenderer'].filter((k) => k in b),
    };
  });
  expect(surface).toEqual({
    top: [
      'app',
      'attachment',
      'autostart',
      'capabilities',
      'drafts',
      'folder',
      'home',
      'item',
      'lease',
      'note',
      'occurrence',
      'palette',
      'project',
      'reminder',
      'reminders',
      'session',
      'settings',
      'shell',
      'sticky',
      'subscribe',
      'trash',
      'tree',
      'versions',
      'widget',
      'window',
      'zones',
    ],
    namespaces: {
      app: ['flushed', 'getInfo', 'quit', 'showDataFolder'],
      attachment: ['importBytes', 'importFromDialog'],
      autostart: ['get', 'set'],
      capabilities: ['get'],
      drafts: ['list', 'resolve'],
      folder: ['create', 'move', 'rename', 'trash'],
      home: ['summary'],
      item: ['setFavorite'],
      lease: ['acquire', 'release', 'take'],
      note: ['convertFormat', 'create', 'move', 'open', 'rename', 'save', 'setPinned', 'trash'],
      occurrence: ['complete', 'snooze'],
      palette: ['searchTitles'],
      project: ['create', 'rename', 'trash'],
      reminder: ['create', 'delete', 'listForNote', 'open', 'undoDelete', 'update'],
      reminders: ['listView', 'summary'],
      session: ['get', 'set'],
      settings: ['get', 'set'],
      shell: ['openExternal'],
      sticky: ['dock', 'float', 'hide', 'remove', 'restore', 'setCollapsed', 'setColor', 'setPinned'],
      trash: ['list', 'purge', 'restore'],
      tree: ['list'],
      versions: ['list', 'restore'],
      widget: ['hide', 'setCollapsed', 'setPinned', 'show'],
      window: ['getState'],
      zones: ['list'],
    },
    frozen: true,
    allFrozen: true,
    subscribeType: 'function',
    subscribeError: 'Unknown event channel',
    noGeneric: [],
  });
  const caps = await page().evaluate(async () => {
    const r = await window.infinity.capabilities.get();
    return r.ok ? r.data : null;
  });
  expect(caps).toMatchObject({ platform: process.platform === 'win32' ? 'win32' : 'linux', notificationActions: { status: 'unsupported' } });
});

test('validation errors', async () => {
  const results = await page().evaluate(async () => {
    const bridge = window.infinity as unknown as {
      settings: { get(r: unknown): Promise<{ ok: boolean; error?: { code: string } }>; set(r: unknown): Promise<{ ok: boolean; error?: { code: string } }> };
    };
    const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error!.code);
    return {
      neon: code(await bridge.settings.set({ key: 'appearance.theme', value: 'neon' })),
      unknown: code(await bridge.settings.set({ key: 'x.y', value: 1 })),
      huge: code(await bridge.settings.set({ key: 'appearance.theme', value: 'x'.repeat(6 * 1024 * 1024) })),
      injection: code(await bridge.settings.get({ keys: ["appearance.theme'; DROP TABLE settings;--"] })),
      empty: code(await bridge.settings.get({ keys: [] })),
      extra: code(await bridge.settings.get({ keys: ['appearance.theme'], more: true })),
    };
  });
  expect(results).toEqual({
    neon: 'VALIDATION_FAILED',
    unknown: 'VALIDATION_FAILED',
    huge: 'LIMIT_EXCEEDED',
    injection: 'VALIDATION_FAILED',
    empty: 'VALIDATION_FAILED',
    extra: 'VALIDATION_FAILED',
  });
  await h.stop();
  expect(h.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'")).toHaveLength(1);
  expect(h.one<{ n: number }>('SELECT count(*) AS n FROM settings')?.n).toBe(0);
});

test('renderer cannot read files', async () => {
  const secretTxt = path.join(h.userData, 'secret.txt');
  const secretPng = path.join(h.userData, 'secret.png');
  fs.writeFileSync(secretTxt, 'top secret');
  fs.writeFileSync(secretPng, makePng(2, 2));
  const toUrl = (p: string) => 'file:///' + p.replace(/\\/g, '/').replace(/^\//, '');
  const outcome = await page().evaluate(
    async ({ txt, png }) => {
      const viaFetch = await fetch(txt).then(() => 'read', () => 'blocked');
      const viaXhr = await new Promise<string>((resolve) => {
        const x = new XMLHttpRequest();
        x.open('GET', txt);
        x.onload = () => resolve('read');
        x.onerror = () => resolve('blocked');
        try {
          x.send();
        } catch {
          resolve('blocked');
        }
      });
      const viaImg = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => resolve('read');
        img.onerror = () => resolve('blocked');
        img.src = png;
      });
      return { viaFetch, viaXhr, viaImg };
    },
    { txt: toUrl(secretTxt), png: toUrl(secretPng) },
  );
  expect(outcome).toEqual({ viaFetch: 'blocked', viaXhr: 'blocked', viaImg: 'blocked' });
});

test('attachment protocol', async () => {
  // Seed rows and files after the first launch (the database is migrated), then relaunch.
  await h.stop();
  const pngId = randomUUID();
  const pdfId = randomUUID();
  const dataDir = path.join(h.userData, 'data');
  fs.mkdirSync(path.join(dataDir, 'attachments', 'ab'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'attachments', 'ab', 'pic.png'), makePng(2, 2));
  fs.writeFileSync(path.join(dataDir, 'attachments', 'ab', 'doc.pdf'), '%PDF-1.4 test');
  h.writeWhileClosed((db) => {
    const add = db.prepare(
      "INSERT INTO attachments(id, managed_relative_path, sha256, mime, size_bytes, original_name, kind, created_at) VALUES (?, ?, ?, ?, 1, 'x', ?, 1)",
    );
    add.run(pngId, 'attachments/ab/pic.png', 'a'.repeat(64), 'image/png', 'image');
    add.run(pdfId, 'attachments/ab/doc.pdf', 'b'.repeat(64), 'application/pdf', 'document');
  });

  await h.start();
  const loads = await page().evaluate(
    async ({ pngId: png, pdfId: pdf, unknown }) => {
      const probe = (src: string) =>
        new Promise<number>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalWidth);
          img.onerror = () => resolve(-1);
          img.src = src;
        });
      return {
        ok: await probe(`infinity-attachment://${png}`),
        unknown: await probe(`infinity-attachment://${unknown}`),
        traversal: await probe(`infinity-attachment://${png}/../../infinity-notes.sqlite3`),
        encoded: await probe(`infinity-attachment://${png}/%2e%2e%2f%2e%2e%2finfinity-notes.sqlite3`),
        notUuid: await probe('infinity-attachment://not-a-uuid'),
        document: await probe(`infinity-attachment://${pdf}`),
      };
    },
    { pngId, pdfId, unknown: randomUUID() },
  );
  expect(loads).toEqual({ ok: 2, unknown: -1, traversal: -1, encoded: -1, notUuid: -1, document: -1 });
});

test('sticky windows are hardened (INF-FND-03, INF-FND-04, D-064)', async () => {
  const own = await page().evaluate(async () => {
    const r = await window.infinity.note.create({ location: { projectId: null, folderId: null }, sticky: true, title: 'Hardened' });
    return r.ok ? r.data.note.id : '';
  });
  const other = await page().evaluate(async () => {
    const r = await window.infinity.note.create({ location: { projectId: null, folderId: null }, sticky: false, title: 'Other' });
    return r.ok ? r.data.note.id : '';
  });
  await page().evaluate((id) => window.infinity.sticky.float({ noteId: id }), own);
  const sticky = await stickyPage(app(), own);
  expect(sticky.url()).toBe(`infinity-app://renderer/index.html#/sticky/${own}`);

  const prefs = await app().evaluate(({ BrowserWindow }, id) => {
    const of = (suffix: string) =>
      (BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(suffix))!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences();
    const pick = (p: Record<string, unknown>) =>
      Object.fromEntries(['contextIsolation', 'nodeIntegration', 'sandbox', 'webSecurity', 'webviewTag', 'allowRunningInsecureContent', 'navigateOnDragDrop', 'spellcheck'].map((k) => [k, p[k]]));
    return { main: pick(of('#/')), sticky: pick(of(`#/sticky/${id}`)) };
  }, own);
  expect(prefs.sticky).toEqual(prefs.main);
  expect(prefs.sticky).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false });
  const sandbox = await rendererSandbox(app(), `#/sticky/${own}`);
  console.log(`sticky renderer sandbox: ${sandbox.evidence}`);
  expect(sandbox.osSandboxed, sandbox.evidence).toBe(true);

  const answers = await sticky.evaluate(
    async ([mine, theirs]) => {
      const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error!.code);
      const b = window.infinity;
      return {
        sessionSet: code(await b.session.set({ session: { version: 1, tabs: [{ id: 'home', kind: 'home' }], activeTabId: 'home' } } as never)),
        treeList: code(await b.tree.list()),
        trashPurge: code(await b.trash.purge({ target: { kind: 'all' }, confirmed: true })),
        float: code(await b.sticky.float({ noteId: mine! })),
        openOther: code(await b.note.open({ noteId: theirs! })),
        openOwn: code(await b.note.open({ noteId: mine! })),
      };
    },
    [own, other],
  );
  expect(answers).toEqual({ sessionSet: 'FORBIDDEN', treeList: 'FORBIDDEN', trashPurge: 'FORBIDDEN', float: 'FORBIDDEN', openOther: 'FORBIDDEN', openOwn: 'ok' });
  expect(readMainLog(h.userData)).toContain('ipc: channel not allowed for role=sticky channel=session:set');
});

test('the widget window is hardened and limited to its allowlist (INF-FND-03, D-074, D-081)', async () => {
  const ids = await page().evaluate(async () => {
    const make = async (title: string, sticky: boolean) => {
      const r = await window.infinity.note.create({ location: { projectId: null, folderId: null }, sticky, title });
      return r.ok ? r.data.note.id : '';
    };
    return { own: await make('Own sticky', true), other: await make('Other note', false) };
  });
  const theirs = await page().evaluate(async (noteId) => {
    const r = await window.infinity.reminder.create({ noteId, blockId: null, title: 'Other reminder', zoneId: Intl.DateTimeFormat().resolvedOptions().timeZone, date: '2099-01-01', time: '09:00', recurrence: null, followup: null });
    return r.ok ? r.data.id : '';
  }, ids.other);
  await page().evaluate(() => window.infinity.widget.show());
  await expect.poll(() => app().windows().some((p) => p.url().endsWith('#/widget'))).toBe(true);
  const widget = app().windows().find((p) => p.url().endsWith('#/widget'))!;
  await widget.getByRole('toolbar', { name: 'Reminder widget' }).waitFor();
  expect(widget.url()).toBe('infinity-app://renderer/index.html#/widget');
  const prefs = await app().evaluate(({ BrowserWindow }) => {
    const of = (suffix: string) =>
      (BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(suffix))!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences();
    const pick = (p: Record<string, unknown>) =>
      Object.fromEntries(['contextIsolation', 'nodeIntegration', 'sandbox', 'webSecurity', 'webviewTag', 'allowRunningInsecureContent', 'navigateOnDragDrop', 'spellcheck'].map((k) => [k, p[k]]));
    return { main: pick(of('#/')), widget: pick(of('#/widget')) };
  });
  expect(prefs.widget).toEqual(prefs.main);
  const sandbox = await rendererSandbox(app(), '#/widget');
  console.log(`widget renderer sandbox: ${sandbox.evidence}`);
  expect(sandbox.osSandboxed, sandbox.evidence).toBe(true);
  const answers = await widget.evaluate(async ([noteId]) => {
    const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error!.code);
    const b = window.infinity;
    return {
      noteOpen: code(await b.note.open({ noteId: noteId! })),
      sessionSet: code(await b.session.set({ session: { version: 1, tabs: [{ id: 'home', kind: 'home' }], activeTabId: 'home' } } as never)),
      reminderCreate: code(await b.reminder.create({ noteId: noteId!, blockId: null, title: 'x', zoneId: 'UTC', date: '2099-01-01', time: '09:00', recurrence: null, followup: null })),
      widgetShow: code(await b.widget.show()),
      listView: code(await b.reminders.listView({ view: 'upcoming' })),
    };
  }, [ids.other]);
  expect(answers).toEqual({ noteOpen: 'FORBIDDEN', sessionSet: 'FORBIDDEN', reminderCreate: 'FORBIDDEN', widgetShow: 'FORBIDDEN', listView: 'ok' });
  // A sticky may open only its own note's reminders.
  await page().evaluate((id) => window.infinity.sticky.float({ noteId: id }), ids.own);
  const sticky = await stickyPage(app(), ids.own);
  expect(await sticky.evaluate((id) => window.infinity.reminder.open({ reminderId: id }), theirs)).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });
  expect(readMainLog(h.userData)).toContain('ipc: channel not allowed for role=widget channel=note:open');
});
