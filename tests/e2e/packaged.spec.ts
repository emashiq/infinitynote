import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { closeApp, dbFileOf, launchApp, makeUserDataDir, packagedExe, readMainLog, removeDir, type Launched } from './fixtures';

let userData = '';
let launched: Launched | null = null;

test.beforeEach(() => {
  test.skip(packagedExe === '', 'INFINITY_NOTES_PACKAGED_EXE is not set (run npm run test:e2e:packaged)');
  userData = makeUserDataDir();
});

test.afterEach(async () => {
  await closeApp(launched?.app);
  launched = null;
  if (userData) await removeDir(userData);
});

test('packaged app starts, reports diagnostics and persists the theme @packaged', async () => {
  launched = await launchApp({ userDataDir: userData });
  await expect(launched.page.locator('h1')).toHaveText('Infinity Notes');
  const info = await launched.page.evaluate(async () => {
    const r = await window.infinity.app.getInfo();
    return r.ok ? r.data : null;
  });
  expect(info?.isPackaged).toBe(true);
  expect(info?.sqlite).toMatchObject({ driver: 'better-sqlite3', fts5: true, json: true });
  expect(info?.schemaVersion).toBe(1);
  expect(info?.startup).toEqual({ status: 'ok' });

  await launched.page.getByLabel('Dark').check();
  await expect(launched.page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(async () => launched!.page.evaluate(async () => {
      const r = await window.infinity.settings.get({ keys: ['appearance.theme'] });
      return r.ok ? r.data.values['appearance.theme'] : null;
    }))
    .toBe('dark');
  await closeApp(launched.app);

  launched = await launchApp({ userDataDir: userData });
  await expect(launched.page.getByLabel('Dark')).toBeChecked();
});

test('packaged override honored and test hooks absent @packaged', async () => {
  launched = await launchApp({ userDataDir: userData });
  const { app } = launched;
  const reported = await app.evaluate(({ app: a }) => a.getPath('userData'));
  expect(path.resolve(reported)).toBe(path.resolve(userData));
  expect(fs.existsSync(dbFileOf(userData))).toBe(true);
  expect(readMainLog(userData)).toContain('userDataOverride=on');
  expect(readMainLog(userData)).toContain('packaged=true');

  // INFINITY_NOTES_E2E=1 is set by the fixture; hooks must still be absent in a packaged build.
  expect(await app.evaluate(() => typeof globalThis.__infinityTest)).toBe('undefined');

  // Nothing named "data" next to the executable.
  expect(fs.existsSync(path.join(path.dirname(packagedExe), 'data'))).toBe(false);

  // Real packaged renderer: served from the asar through the custom scheme.
  expect(launched.page.url().startsWith('infinity-app://renderer/')).toBe(true);
  const sandboxed = await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): { sandbox: boolean; contextIsolation: boolean } };
    return wc.getLastWebPreferences();
  });
  expect(sandboxed.sandbox).toBe(true);
  expect(sandboxed.contextIsolation).toBe(true);
});
