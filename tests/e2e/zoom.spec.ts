import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { paletteAction, queueDialog } from './editor-ui';
import { useApp } from './harness';
import { COMMON, createNote } from './seed';
import { stickyPage } from './sticky-ui';
import { activate, dialogByName, tabItem } from './ui';

/** Window zoom (D-186): per kind of window, kept by main; viewers with a zoom of their own take it over their page. */
const h = useApp({ failOnMainErrors: true });
const FIXTURES = path.resolve('tests/fixtures/documents');

/** The zoom factor main applied to the window whose URL ends with `suffix`. */
function zoomOf(app: ElectronApplication, suffix: string): Promise<number> {
  return app.evaluate(({ BrowserWindow }, end) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(end));
    return win ? Math.round(win.webContents.getZoomFactor() * 100) / 100 : -1;
  }, suffix);
}

/** Electron's `zoom-changed` on a window's webContents, as a mouse wheel notch with Ctrl raises it. */
async function wheelZoom(app: ElectronApplication, suffix: string, direction: 'in' | 'out') {
  await app.evaluate(
    ({ BrowserWindow }, [end, dir]) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(end!));
      win!.webContents.emit('zoom-changed', {}, dir);
    },
    [suffix, direction],
  );
}

const indicator = (page: Page) => page.getByRole('banner').locator('.zoom-indicator');

async function ready(page: Page) {
  await page.locator('#app-shell[data-ready="true"]').waitFor();
}

async function ctrlWheel(page: Page, deltaY: number) {
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

test('keys, the View menu, the palette and Ctrl+wheel zoom the main window; the zoom outlives a reload and a restart', async () => {
  const { app, page } = await h.start();
  await ready(page);
  const ratio = await page.evaluate(() => window.devicePixelRatio);
  await expect(indicator(page)).toHaveCount(0);

  await page.keyboard.press('Control+Equal');
  await expect.poll(() => zoomOf(app, '#/')).toBe(1.1);
  await expect(indicator(page)).toHaveText('110%');
  // The page really is drawn larger: Chromium scales its device pixel ratio.
  await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(ratio * 1.1, 2);
  await page.keyboard.press('Control+Minus');
  await page.keyboard.press('Control+Minus');
  await expect.poll(() => zoomOf(app, '#/')).toBe(0.9);
  await expect(indicator(page)).toHaveText('90%');
  await page.keyboard.press('Control+0');
  await expect.poll(() => zoomOf(app, '#/')).toBe(1);
  await expect(indicator(page)).toHaveCount(0);

  const menubar = page.getByRole('menubar', { name: 'Application menu' });
  await activate(menubar.getByRole('menuitem', { name: 'View' }));
  const view = page.getByRole('menu', { name: 'View' });
  await expect(view.getByRole('menuitem', { name: 'Zoom in' })).toHaveAttribute('aria-keyshortcuts', 'Ctrl+=');
  await expect(view.getByRole('menuitem', { name: 'Zoom out' })).toHaveAttribute('aria-keyshortcuts', 'Ctrl+-');
  await activate(view.getByRole('menuitem', { name: 'Zoom in' }));
  await expect.poll(() => zoomOf(app, '#/')).toBe(1.1);
  await paletteAction(page, 'Zoom in');
  await expect.poll(() => zoomOf(app, '#/')).toBe(1.25);
  await expect(indicator(page)).toHaveText('125%');

  // Ctrl+wheel the page leaves alone (no viewer under the pointer) reaches main as Electron's zoom-changed. Chromium raises
  // it only for wheel events with whole notches, which DevTools' synthetic wheel events never have, so the test emits it.
  await wheelZoom(app, '#/', 'in');
  await expect.poll(() => zoomOf(app, '#/')).toBe(1.5);
  await wheelZoom(app, '#/', 'out');
  await expect.poll(() => zoomOf(app, '#/')).toBe(1.25);
  await expect.poll(() => h.setting('window.zoom')).toEqual({ v: 1, value: { main: 125, sticky: 100, widget: 100 } });

  await page.reload();
  await ready(page);
  await expect.poll(() => zoomOf(app, '#/')).toBe(1.25);
  await expect(indicator(page)).toHaveText('125%');

  const restarted = await h.restart();
  await ready(restarted.page);
  await expect.poll(() => zoomOf(restarted.app, '#/')).toBe(1.25);
  await activate(indicator(restarted.page));
  await expect.poll(() => zoomOf(restarted.app, '#/')).toBe(1);
  await expect(indicator(restarted.page)).toHaveCount(0);
});

test('every sticky shares one zoom and the main window keeps its own', async () => {
  const { app, page } = await h.start();
  await ready(page);
  const first = await createNote(page, COMMON, 'First sticky', { sticky: true });
  const second = await createNote(page, COMMON, 'Second sticky', { sticky: true });
  await page.evaluate((noteId) => window.infinity.sticky.float({ noteId }), first);
  const sticky = await stickyPage(app, first);
  await sticky.locator('.ProseMirror').click();
  await sticky.keyboard.press('Control+Equal');
  await sticky.keyboard.press('Control+Equal');
  await expect.poll(() => zoomOf(app, `#/sticky/${first}`)).toBe(1.25);
  // Same origin, isolated zoom: the main window is not affected.
  expect(await zoomOf(app, '#/')).toBe(1);
  await page.evaluate((noteId) => window.infinity.sticky.float({ noteId }), second);
  await stickyPage(app, second);
  await expect.poll(() => zoomOf(app, `#/sticky/${second}`)).toBe(1.25);
  await expect.poll(() => h.setting('window.zoom')).toEqual({ v: 1, value: { main: 100, sticky: 125, widget: 100 } });

  await page.keyboard.press('Control+Minus');
  await expect.poll(() => zoomOf(app, '#/')).toBe(0.9);
  expect(await zoomOf(app, `#/sticky/${first}`)).toBe(1.25);
});

test('a PDF zooms its pages and a web page its frame, not the window', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-zoom-')));
  try {
    const { app, page } = await h.start();
    await ready(page);
    const pdf = path.join(dir, 'Figures.pdf');
    fs.copyFileSync(path.join(FIXTURES, 'sample-pages.pdf'), pdf);
    await queueDialog(app, [pdf]);
    await paletteAction(page, 'Import file…');
    await activate(dialogByName(page, 'Add file').getByRole('button', { name: 'Copy into Infinity Notes' }));
    await expect(tabItem(page, 'Figures')).toHaveAttribute('aria-selected', 'true');
    const pdfZoom = page.locator('.pdf-viewer select.pdf-zoom');
    await expect(pdfZoom).toBeEnabled();
    await expect(pdfZoom).toHaveValue('auto');

    const pages = page.locator('.pdf-viewer .pdfViewer');
    const box = (await pages.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await ctrlWheel(page, -100);
    await expect(pdfZoom).not.toHaveValue('auto');
    const zoomedIn = Number(await pdfZoom.inputValue());
    expect(await zoomOf(app, '#/')).toBe(1);
    // The keys too, with the focus in the viewer; Ctrl+0 fits the pages again.
    await page.locator('.pdf-viewer').focus();
    await page.keyboard.press('Control+Minus');
    await expect.poll(async () => Number(await pdfZoom.inputValue())).toBeLessThan(zoomedIn);
    await page.keyboard.press('Control+0');
    await expect(pdfZoom).toHaveValue('auto');
    expect(await zoomOf(app, '#/')).toBe(1);

    const html = path.join(dir, 'Page.html');
    fs.copyFileSync(path.join(FIXTURES, 'sample.html'), html);
    await queueDialog(app, [html]);
    await paletteAction(page, 'Import file…');
    await activate(dialogByName(page, 'Add file').getByRole('button', { name: 'Copy into Infinity Notes' }));
    await expect(tabItem(page, 'Page')).toHaveAttribute('aria-selected', 'true');
    const control = page.locator('.html-viewer').getByRole('group', { name: 'Zoom' });
    await activate(control.getByRole('button', { name: 'Zoom in (Ctrl+=)' }));
    await activate(control.getByRole('button', { name: 'Zoom in (Ctrl+=)' }));
    await expect(control.getByRole('button', { name: /^Zoom 125%/ })).toBeVisible();
    await expect.poll(() => page.locator('.html-frame').evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(1.25, 0, 0, 1.25, 0, 0)');
    await page.keyboard.press('Control+0');
    await expect(control.getByRole('button', { name: /^Zoom 100%/ })).toBeVisible();
    expect(await zoomOf(app, '#/')).toBe(1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
