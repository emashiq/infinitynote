import { expect, test, type Page } from '@playwright/test';
import { useApp } from './harness';
import { COMMON, createNote } from './seed';
import { activeTabLabel, openFromTree, tabLabels } from './ui';
import { pressClosing, stickyHeader, stickyPage, windowsOf } from './sticky-ui';
import { widgetPage } from './reminder-ui';

/** The custom title bars (D-097): one app-drawn bar in the main window, frameless stickies and widget. */
const h = useApp({ failOnMainErrors: true });

const appRegion = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region').trim());
const menubar = (page: Page) => page.getByRole('menubar', { name: 'Application menu' });

test('one title bar: brand, menus, centered search; a drag region whose controls are not', async () => {
  const { app, page } = await h.start();
  const header = page.getByRole('banner');
  await expect(header.locator('h1')).toHaveText('Infinity Notes');
  await expect(menubar(page).getByRole('menuitem')).toHaveText(['File', 'View', 'Help']);
  await expect(header.getByRole('button', { name: 'Search notes and commands (Ctrl+K)' }).locator('kbd')).toHaveText(['Ctrl', 'K']);
  expect(await page.locator('header').count()).toBe(1);
  expect(await appRegion(page, '.app-header')).toBe('drag');
  for (const selector of ['.menubar', '.search-box', '.header-actions button']) expect(await appRegion(page, selector), selector).toBe('no-drag');
  // The OS draws the caption buttons over the bar (titleBarOverlay); there is no OS menu bar.
  const native = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!;
    return { menuBar: win.isMenuBarVisible(), contentY: win.getContentBounds().y - win.getBounds().y };
  });
  expect(native.menuBar).toBe(false);
  expect(native.contentY).toBe(0);
});

test('menus by keyboard: Alt focuses the bar, arrows move, Enter runs, Escape closes (D-097)', async () => {
  const { page } = await h.start();
  await page.locator('#app-shell[data-ready="true"]').waitFor();
  await page.keyboard.press('Alt');
  await expect(menubar(page).getByRole('menuitem', { name: 'File' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(menubar(page).getByRole('menuitem', { name: 'View' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const view = page.getByRole('menu', { name: 'View' });
  await expect(view.getByRole('menuitemradio', { name: 'System theme' })).toHaveAttribute('aria-checked', 'true');
  await view.getByRole('menuitemradio', { name: 'Dark theme' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => h.setting('appearance.theme')).toEqual({ v: 1, value: 'dark' });

  await menubar(page).getByRole('menuitem', { name: 'File' }).focus();
  await page.keyboard.press('Enter');
  const file = page.getByRole('menu', { name: 'File' });
  await expect(file.getByRole('menuitem', { name: 'New note' })).toHaveAttribute('aria-keyshortcuts', 'Ctrl+N');
  await page.keyboard.press('Escape');
  await expect(file).toHaveCount(0);
  await expect(menubar(page).getByRole('menuitem', { name: 'File' })).toBeFocused();
  await page.keyboard.press('Enter');
  await file.getByRole('menuitem', { name: 'New note' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => tabLabels(page)).toHaveLength(2);

  await menubar(page).getByRole('menuitem', { name: 'Help' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menu', { name: 'Help' }).getByRole('menuitem', { name: 'Keyboard shortcuts' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toContainText('Ctrl+Shift+N');
  await expect(dialog).toContainText('New sticky');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await menubar(page).getByRole('menuitem', { name: 'Help' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menu', { name: 'Help' }).getByRole('menuitem', { name: 'About Infinity Notes' }).focus();
  await page.keyboard.press('Enter');
  const about = page.getByRole('dialog', { name: 'About Infinity Notes' });
  await expect(about).toContainText('Version 0.3.0');
  await expect(about).toContainText('Developed by Ashiqur Rahman Emran');
  await expect(about).toContainText('Copyright © 2026 Ashiqur Rahman Emran');
});

test('frameless sticky and widget: the header is the drag region and × closes them (D-097)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Frameless', { sticky: true });
  await openFromTree(page, id);
  await expect.poll(() => activeTabLabel(page)).toBe('Frameless');
  await page.evaluate((noteId) => window.infinity.sticky.float({ noteId }), id);
  const sp = await stickyPage(app, id);
  expect(await appRegion(sp, '.sticky-header')).toBe('drag');
  expect(await appRegion(sp, '.sticky-header button')).toBe('no-drag');
  const frames = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => w.webContents.getURL().includes('#/sticky/'))
      .map((w) => w.getContentBounds().height === w.getBounds().height),
  );
  expect(frames).toEqual([true]);
  await pressClosing(stickyHeader(sp).getByRole('button', { name: 'Close sticky' }));
  await expect.poll(async () => (await windowsOf(app)).stickies).toEqual([]);

  await page.evaluate(() => window.infinity.widget.show());
  const w = await widgetPage(app);
  expect(await appRegion(w, '.widget-header')).toBe('drag');
  await pressClosing(w.getByRole('button', { name: 'Hide widget' }));
  await expect.poll(() => app.windows().filter((p) => !p.isClosed() && p.url().endsWith('#/widget')).length).toBe(0);
});

test('the caption-button overlay matches the bar in each theme and stops above its bottom border (D-097)', async () => {
  const { app, page } = await h.start();
  await page.locator('#app-shell[data-ready="true"]').waitFor();
  const hex = (rgb: string) => `#${rgb.match(/\d+/g)!.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  const bar = async () => {
    const s = await page.locator('.app-header').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, fg: cs.color, height: el.getBoundingClientRect().height, border: parseFloat(cs.borderBottomWidth) };
    });
    return { color: hex(s.bg), symbolColor: hex(s.fg), height: s.height - s.border };
  };
  const applied = () => app.evaluate(() => globalThis.__infinityTest!.titleBarOverlay);
  for (const theme of ['dark', 'light', 'dark'] as const) {
    await page.evaluate((t) => window.infinity.settings.set({ key: 'appearance.theme', value: t }), theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const expected = await bar();
    expect(expected.color, theme).toBe(theme === 'dark' ? '#17181d' : '#ffffff');
    await expect.poll(applied, { message: theme }).toEqual(expected);
  }
  expect((await bar()).height).toBe(43);
});
