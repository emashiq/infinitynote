import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { appArgs, appEnv, appExecutable, closeApp, dbFileOf, readMainLog, spawnAndWait, waitForExit } from './fixtures';
import { useApp } from './harness';
import { activate, railGo } from './ui';

const h = useApp();

test('starts a real window with temp userData', async () => {
  const { app, page } = await h.start();
  expect(await page.title()).toBe('Infinity Notes');
  await expect(page.locator('h1')).toHaveText('Infinity Notes');
  await railGo(page, 'Settings');
  await expect(page.getByText('Version 0.1.0')).toBeVisible();
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  expect(windows).toBe(1);
  const nativeTitle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.getTitle());
  expect(nativeTitle).toBe('Infinity Notes');
});

test('closeApp leaves no live Electron process (teardown race regression)', async () => {
  const { app } = await h.start();
  const proc = app.process();
  const pid = proc.pid!;
  expect(pid).toBeGreaterThan(0);
  await closeApp(app);
  expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true);
  expect(await waitForExit(proc, 1000)).toBe(true);
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  expect(alive).toBe(false);
});

test('temp userData used', async () => {
  await h.start();
  const reported = await h.app.evaluate(({ app }) => app.getPath('userData'));
  expect(path.resolve(reported)).toBe(path.resolve(h.userData));
  expect(fs.existsSync(dbFileOf(h.userData))).toBe(true);
  expect(fs.existsSync(path.join(h.userData, 'logs', 'main.log'))).toBe(true);
  expect(readMainLog(h.userData)).toContain('userDataOverride=on');
});

test('db diagnostics', async () => {
  await h.start();
  const info = await h.page.evaluate(async () => {
    const r = await window.infinity.app.getInfo();
    return r.ok ? r.data : null;
  });
  expect(info).not.toBeNull();
  expect(info!.sqlite).toMatchObject({ driver: 'better-sqlite3', fts5: true, json: true });
  expect(info!.sqlite!.version).toMatch(/^3\.\d+\.\d+$/);
  expect(info!.schemaVersion).toBe(4);
  expect(info!.startup).toEqual({ status: 'ok' });
  expect(info!.isPackaged).toBe(false);
  expect(info!.versions.electron).toBe('44.7.0');
  expect(JSON.stringify(info)).not.toContain(h.userData.replace(/\\/g, '\\\\'));
  await railGo(h.page, 'Settings');
  await expect(h.page.getByText(/Storage ready \(SQLite 3\./)).toBeVisible();
});

test('setting survives relaunch', async () => {
  await h.start();
  await railGo(h.page, 'Settings');
  await activate(h.page.getByRole('radio', { name: 'Dark' }));
  await expect(h.page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(h.page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(async () => h.page.evaluate(async () => {
    const r = await window.infinity.settings.get({ keys: ['appearance.theme'] });
    return r.ok ? r.data.values['appearance.theme'] : null;
  })).toBe('dark');
  await h.stop();

  const row = h.one<{ value: string; updated_at: number }>("SELECT value, updated_at FROM settings WHERE key = 'appearance.theme'")!;
  expect(row.value).toBe('{"v":1,"value":"dark"}');
  expect(row.updated_at).toBeGreaterThan(0);

  await h.start();
  await railGo(h.page, 'Settings');
  await expect(h.page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(h.page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('invalid stored setting falls back', async () => {
  await h.start();
  await railGo(h.page, 'Settings');
  await activate(h.page.getByRole('radio', { name: 'Dark' }));
  await expect.poll(async () => h.page.evaluate(async () => {
    const r = await window.infinity.settings.get({ keys: ['appearance.theme'] });
    return r.ok ? r.data.values['appearance.theme'] : null;
  })).toBe('dark');
  await h.stop();

  h.writeWhileClosed((db) => {
    db.prepare("UPDATE settings SET value = '{\"v\":1,\"value\":\"neon\"}' WHERE key = 'appearance.theme'").run();
  });

  await h.start();
  await railGo(h.page, 'Settings');
  await expect(h.page.getByRole('radio', { name: 'System' })).toBeChecked();
  expect(readMainLog(h.userData)).toContain('settings: invalid stored value key=appearance.theme');
});

test('second instance focuses first', async () => {
  const { app } = await h.start();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.hide());
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.isVisible())).toBe(false);

  const second = await spawnAndWait(appExecutable(), appArgs(), appEnv(h.userData), 15_000);
  expect(second.timedOut).toBe(false);
  expect(second.code).toBe(0);

  await expect
    .poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.isVisible()), { timeout: 10_000 })
    .toBe(true);
  const state = await app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows();
    return { count: wins.length, minimized: wins.find((w) => w.webContents.getURL().endsWith('#/'))!.isMinimized() };
  });
  expect(state).toEqual({ count: 1, minimized: false });
  await expect.poll(() => readMainLog(h.userData)).toContain('second-instance received');
});

test('second instance recreates a main window closed to background (INF-DESK-02, D-066)', async () => {
  const { app } = await h.start();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__infinityTest!.closeChoices.push({ choice: 'background', remember: false });
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.close();
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
  expect(app.process().exitCode).toBeNull();

  const second = await spawnAndWait(appExecutable(), appArgs(), appEnv(h.userData), 15_000);
  expect(second.timedOut).toBe(false);
  expect(second.code).toBe(0);
  await expect
    .poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL(), visible: w.isVisible() }))), { timeout: 15_000 })
    .toEqual([{ url: 'infinity-app://renderer/index.html#/', visible: true }]);
  await expect.poll(() => readMainLog(h.userData)).toContain('window: main recreated');
});

test('no network requests', async () => {
  const { app, page } = await h.start();
  const blocked = () => app.evaluate(() => globalThis.__infinityTest?.blockedRequests ?? ['hooks missing']);
  expect(await blocked()).toEqual([]);

  const rendererFetch = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/');
      return 'resolved';
    } catch {
      return 'rejected';
    }
  });
  expect(rendererFetch).toBe('rejected');

  const mainFetch = await app.evaluate(async ({ net }) => {
    try {
      await net.fetch('https://example.com/');
      return 'resolved';
    } catch {
      return 'rejected';
    }
  });
  expect(mainFetch).toBe('rejected');
  expect(await blocked()).toContain('https://example.com/');

  const restarted = await h.restart();
  expect(await restarted.app.evaluate(() => globalThis.__infinityTest?.blockedRequests ?? ['hooks missing'])).toEqual([]);
});

test('Linux: main.log records the display and ozone line', async () => {
  test.skip(process.platform !== 'linux', 'Linux only');
  await h.start();
  const line = readMainLog(h.userData)
    .split('\n')
    .find((l) => l.includes(' display ozone='));
  expect(line).toBeTruthy();
  console.log(`DISPLAY-LINE ${line}`);
});
