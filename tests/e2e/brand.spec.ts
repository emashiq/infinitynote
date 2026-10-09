import { expect, test, type Locator } from '@playwright/test';
import { blockedRequests, setHook } from './editor-ui';
import { useApp } from './harness';
import { COMMON, createNote } from './seed';
import { stickyPage } from './sticky-ui';

/** The logo in the app and the startup loader (D-109). */
const h = useApp({ failOnMainErrors: true });

/** Width of the loaded image file; 0 while it is not loaded or when it was blocked. */
const loadedWidth = (img: Locator) => img.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0));

test('the title bar and About show the logo, served by the app itself under the CSP', async () => {
  const { app, page } = await h.start();
  const logo = page.getByRole('banner').locator('.brand img');
  await expect(logo).toHaveCount(1);
  await expect.poll(() => loadedWidth(logo)).toBeGreaterThanOrEqual(32);
  expect(await logo.getAttribute('src')).not.toMatch(/^data:/);
  expect(await logo.getAttribute('srcset')).toMatch(/1x, .+ 2x$/);

  await page.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'Help' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menu', { name: 'Help' }).getByRole('menuitem', { name: 'About Infinity Notes' }).focus();
  await page.keyboard.press('Enter');
  const aboutLogo = page.getByRole('dialog', { name: 'About Infinity Notes' }).locator('img.about-logo');
  await expect.poll(() => loadedWidth(aboutLogo)).toBeGreaterThanOrEqual(64);
  expect(await blockedRequests(app)).toEqual([]);

  // The tray icon is built from resources/brand/tray-*.png wherever the desktop has a tray.
  const caps = await page.evaluate(() => window.infinity.capabilities.get());
  const trayPresent = await app.evaluate(() => globalThis.__infinityTest!.tray?.present ?? false);
  expect(trayPresent).toBe(caps.ok && caps.data.tray.status === 'supported');
});

test('startup loader: logo and name while the main window starts, gone once the shell is ready; never in a sticky', async () => {
  const { app, page } = await h.start();
  const loader = page.locator('#startup-loader');
  await expect(page.locator('#app-shell[data-ready="true"]')).toBeVisible();
  await expect(loader).toHaveCount(0);
  // The native window background is the theme's page background, so no white frame shows before the page paints.
  const native = await app.evaluate(({ BrowserWindow, nativeTheme }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!;
    return { background: win.getBackgroundColor().toLowerCase(), dark: nativeTheme.shouldUseDarkColors };
  });
  expect(native.background.startsWith(native.dark ? '#17181d' : '#ffffff')).toBe(true);

  // A slow start: main holds app:getInfo back, so the renderer stays on the loader for a while.
  await setHook(app, 'startupDelayMs', 2000);
  await page.reload();
  await expect(loader).toBeVisible();
  await expect(loader.getByText('Infinity Notes')).toBeVisible();
  await expect.poll(() => loadedWidth(loader.locator('img'))).toBeGreaterThanOrEqual(128);
  await expect.poll(() => loader.locator('img').evaluate((i) => Number(getComputedStyle(i).opacity))).toBeGreaterThan(0.5);
  await expect(page.locator('#app-shell[data-ready="true"]')).toBeVisible({ timeout: 30_000 });
  await expect(loader).toHaveCount(0);

  await setHook(app, 'startupDelayMs', 0);
  const id = await createNote(page, COMMON, 'Sticky');
  await page.evaluate((noteId) => window.infinity.sticky.float({ noteId }), id);
  const sticky = await stickyPage(app, id);
  await expect(sticky.locator('#startup-loader')).toHaveCount(0);
});
