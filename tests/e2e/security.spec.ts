import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PROD_CSP } from '../../src/shared/csp';
import { makePng } from '../support/png';
import { closeApp, dbFileOf, launchApp, makeUserDataDir, openDb, readMainLog, removeDir, type Launched } from './fixtures';

let userData = '';
let launched: Launched | null = null;

test.beforeEach(async () => {
  userData = makeUserDataDir();
  launched = await launchApp({ userDataDir: userData });
});

test.afterEach(async () => {
  await closeApp(launched?.app);
  launched = null;
  await removeDir(userData);
});

const page = () => launched!.page;
const app = () => launched!.app;

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
  expect(await app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getURL())).toBe('infinity-app://renderer/index.html#/');
  expect(readMainLog(userData)).toContain('blocked navigation url=https://example.com');
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
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> };
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

test('bridge surface', async () => {
  const surface = await page().evaluate(() => {
    const b = window.infinity as unknown as Record<string, unknown>;
    const keys = (o: unknown) => Object.keys(o as object).sort();
    let subscribeError = '';
    try {
      window.infinity.subscribe('note:revision' as never, () => {});
    } catch (e) {
      subscribeError = (e as Error).message;
    }
    return {
      top: keys(b),
      app: keys(b.app),
      settings: keys(b.settings),
      capabilities: keys(b.capabilities),
      frozen: Object.isFrozen(b),
      subscribeType: typeof b.subscribe,
      subscribeError,
      noGeneric: ['invoke', 'send', 'on', 'ipcRenderer'].filter((k) => k in b),
    };
  });
  expect(surface).toEqual({
    top: ['app', 'capabilities', 'settings', 'subscribe'],
    app: ['getInfo', 'quit', 'showDataFolder'],
    settings: ['get', 'set'],
    capabilities: ['get'],
    frozen: true,
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
  await closeApp(app());
  const db = openDb(dbFileOf(userData), { readonly: true });
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'").all() as unknown[]).length;
  const rows = (db.prepare('SELECT count(*) AS n FROM settings').get() as { n: number }).n;
  db.close();
  expect(tables).toBe(1);
  expect(rows).toBe(0);
});

test('renderer cannot read files', async () => {
  const secretTxt = path.join(userData, 'secret.txt');
  const secretPng = path.join(userData, 'secret.png');
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
  await closeApp(app());
  const pngId = randomUUID();
  const pdfId = randomUUID();
  const dataDir = path.join(userData, 'data');
  fs.mkdirSync(path.join(dataDir, 'attachments', 'ab'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'attachments', 'ab', 'pic.png'), makePng(2, 2));
  fs.writeFileSync(path.join(dataDir, 'attachments', 'ab', 'doc.pdf'), '%PDF-1.4 test');
  const db = openDb(dbFileOf(userData));
  const add = db.prepare(
    "INSERT INTO attachments(id, managed_relative_path, sha256, mime, size_bytes, original_name, kind, created_at) VALUES (?, ?, ?, ?, 1, 'x', ?, 1)",
  );
  add.run(pngId, 'attachments/ab/pic.png', 'a'.repeat(64), 'image/png', 'image');
  add.run(pdfId, 'attachments/ab/doc.pdf', 'b'.repeat(64), 'application/pdf', 'document');
  db.close();

  launched = await launchApp({ userDataDir: userData });
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
