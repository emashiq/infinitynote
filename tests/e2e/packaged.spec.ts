import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { dbFileOf, packagedExe, readMainLog, rendererSandbox } from './fixtures';
import { useApp } from './harness';
import { stickyPage } from './sticky-ui';
import { activate, railGo } from './ui';

const h = useApp();

test.beforeEach(() => {
  test.skip(packagedExe === '', 'INFINITY_NOTES_PACKAGED_EXE is not set (run npm run test:e2e:packaged)');
});

test('packaged app starts, reports diagnostics and persists the theme @packaged', async () => {
  const { page } = await h.start();
  await expect(page.locator('h1')).toHaveText('Infinity Notes');
  const info = await page.evaluate(async () => {
    const r = await window.infinity.app.getInfo();
    return r.ok ? r.data : null;
  });
  expect(info?.isPackaged).toBe(true);
  expect(info?.sqlite).toMatchObject({ driver: 'better-sqlite3', fts5: true, json: true });
  expect(info?.schemaVersion).toBe(4);
  expect(info?.startup).toEqual({ status: 'ok' });

  await railGo(page, 'Settings');
  await activate(page.getByRole('radio', { name: 'Dark' }));
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const r = await window.infinity.settings.get({ keys: ['appearance.theme'] });
        return r.ok ? r.data.values['appearance.theme'] : null;
      }),
    )
    .toBe('dark');

  const restarted = await h.restart();
  await railGo(restarted.page, 'Settings');
  await expect(restarted.page.getByRole('radio', { name: 'Dark' })).toBeChecked();
});

test('packaged override honored and test hooks absent @packaged', async () => {
  const { app, page } = await h.start();
  const reported = await app.evaluate(({ app: a }) => a.getPath('userData'));
  expect(path.resolve(reported)).toBe(path.resolve(h.userData));
  expect(fs.existsSync(dbFileOf(h.userData))).toBe(true);
  expect(readMainLog(h.userData)).toContain('userDataOverride=on');
  expect(readMainLog(h.userData)).toContain('packaged=true');

  // INFINITY_NOTES_E2E=1 is set by the fixture; hooks must still be absent in a packaged build.
  expect(await app.evaluate(() => typeof globalThis.__infinityTest)).toBe('undefined');

  // Nothing named "data" next to the executable.
  expect(fs.existsSync(path.join(path.dirname(packagedExe), 'data'))).toBe(false);

  // Real packaged renderer: served from the asar through the custom scheme, in the OS sandbox.
  expect(page.url().startsWith('infinity-app://renderer/')).toBe(true);
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.webContents as unknown as { getLastWebPreferences(): { sandbox: boolean; contextIsolation: boolean } };
    return wc.getLastWebPreferences();
  });
  expect(prefs.sandbox).toBe(true);
  expect(prefs.contextIsolation).toBe(true);
  const sandbox = await rendererSandbox(app);
  console.log(`renderer sandbox: ${sandbox.evidence}`);
  expect(sandbox.osSandboxed, sandbox.evidence).toBe(true);
});

test('packaged sticky window is sandboxed and test seams are ignored @packaged', async () => {
  const { app, page } = await h.start({ INFINITY_NOTES_TEST_CAPS: JSON.stringify({ tray: 'unsupported', alwaysOnTop: 'unsupported' }) });
  const caps = await page.evaluate(async () => {
    const r = await window.infinity.capabilities.get();
    return r.ok ? r.data : null;
  });
  expect(JSON.stringify(caps)).not.toContain('test-override');
  expect(readMainLog(h.userData)).not.toContain('INFINITY_NOTES_TEST_CAPS');

  const id = await page.evaluate(async () => {
    const r = await window.infinity.note.create({ location: { projectId: null, folderId: null }, sticky: true, title: 'Packaged sticky' });
    return r.ok ? r.data.note.id : '';
  });
  expect(await page.evaluate((n) => window.infinity.sticky.float({ noteId: n }), id)).toMatchObject({ ok: true, data: { created: true } });
  const sticky = await stickyPage(app, id);
  expect(sticky.url()).toBe(`infinity-app://renderer/index.html#/sticky/${id}`);
  const prefs = await app.evaluate(({ BrowserWindow }, n) => {
    const wc = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(`#/sticky/${n}`))!.webContents as unknown as {
      getLastWebPreferences(): { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean };
    };
    return wc.getLastWebPreferences();
  }, id);
  expect(prefs).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
  const sandbox = await rendererSandbox(app, `#/sticky/${id}`);
  console.log(`packaged sticky renderer sandbox: ${sandbox.evidence}`);
  expect(sandbox.osSandboxed, sandbox.evidence).toBe(true);
  expect(await app.evaluate(() => typeof globalThis.__infinityTest)).toBe('undefined');
});
