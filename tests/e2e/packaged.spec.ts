import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { dbFileOf, packagedExe, readMainLog, rendererSandbox } from './fixtures';
import { useApp } from './harness';
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
  expect(info?.schemaVersion).toBe(3);
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
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): { sandbox: boolean; contextIsolation: boolean } };
    return wc.getLastWebPreferences();
  });
  expect(prefs.sandbox).toBe(true);
  expect(prefs.contextIsolation).toBe(true);
  const sandbox = await rendererSandbox(app);
  console.log(`renderer sandbox: ${sandbox.evidence}`);
  expect(sandbox.osSandboxed, sandbox.evidence).toBe(true);
});
