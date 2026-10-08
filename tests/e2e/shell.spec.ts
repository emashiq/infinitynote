import { expect, test, type Page } from '@playwright/test';
import { setContentSize } from './fixtures';
import { useApp } from './harness';
import { COMMON, createNote, createProject, reloadUi } from './seed';
import { activate, activeTabLabel, openByPalette, primaryNav, railGo, tabLabels, tabs } from './ui';

const h = useApp();

/** Resolves a CSS custom property to the computed color the browser really paints. */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;background-color:var(${t})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, token);
}

test('rail navigation', async () => {
  const { app, page } = await h.start();
  await setContentSize(app, page, 1100, 720);
  await expect(page.locator('h1')).toHaveText('Infinity Notes');
  const buttons = primaryNav(page).getByRole('button');
  await expect(buttons).toHaveCount(5);
  expect(await buttons.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Home', 'Notes', 'Stickies', 'Reminders', 'Settings']);
  const search = page.getByRole('button', { name: 'Search notes and commands (Ctrl+K)' });
  await expect(search.locator('kbd')).toHaveText(['Ctrl', 'K']);
  await expect(page.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab', { name: 'Home' })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    return { rail: box('nav[aria-label="Primary"]').width, header: box('header').height, strip: box('.tab-strip').height };
  });
  expect(Math.abs(geometry.rail - 52)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.header - 44)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.strip - 36)).toBeLessThanOrEqual(1);

  const accentSoft = await tokenColor(page, '--accent-soft');
  const accent = await tokenColor(page, '--accent');
  expect(accent).toBe('rgb(106, 90, 224)');
  for (const name of ['Stickies', 'Reminders', 'Settings', 'Home'] as const) {
    await railGo(page, name);
    await expect.poll(() => activeTabLabel(page)).toBe(name);
    const rail = primaryNav(page).getByRole('button', { name, exact: true });
    await expect(rail).toHaveAttribute('aria-current', 'page');
    expect(await rail.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(accentSoft);
    expect(await page.locator('.tab.is-active').evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(accent);
    await expect(primaryNav(page).locator('[aria-current="page"]')).toHaveCount(1);
  }
});

test('no capture-specific labels', async () => {
  const { page } = await h.start();
  const banned = /\b(capture|recording|record|screenshot|framecapt)\b|saving to/i;
  for (const name of ['Home', 'Stickies', 'Reminders', 'Settings'] as const) {
    await railGo(page, name);
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(banned);
  }
  const labels = await page.evaluate(() => [...document.querySelectorAll('[aria-label],[title]')].map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`).join('\n'));
  expect(labels).not.toMatch(banned);
});

test('tree toggle and width persists', async () => {
  const { app, page } = await h.start();
  await setContentSize(app, page, 1280, 800);
  const tree = page.getByRole('navigation', { name: 'Notes' });
  await expect(tree).toBeVisible();
  await activate(page.getByRole('button', { name: /Toggle notes tree/ }));
  await expect(tree).toHaveCount(0);
  await page.keyboard.press('Control+Backslash');
  await expect(tree).toBeVisible();

  const splitter = page.getByRole('separator', { name: 'Resize notes tree' });
  await expect(splitter).toHaveAttribute('aria-valuemin', '220');
  await expect(splitter).toHaveAttribute('aria-valuemax', '280');
  await expect(splitter).toHaveAttribute('aria-valuenow', '248');
  const width = () => tree.evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs((await width()) - 248)).toBeLessThanOrEqual(1);
  await splitter.focus();
  for (let i = 0; i < 3; i += 1) await splitter.press('ArrowRight');
  await expect(splitter).toHaveAttribute('aria-valuenow', '272');
  await splitter.press('End');
  await expect(splitter).toHaveAttribute('aria-valuenow', '280');
  await splitter.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', '220');

  // Pointer behavior: a real drag of +20 px from 220 gives 240.
  const box = (await splitter.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 200;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y, { steps: 4 });
  await page.mouse.move(x + 20, y, { steps: 4 });
  await page.mouse.up();
  await expect(splitter).toHaveAttribute('aria-valuenow', '240');
  await expect.poll(() => h.setting('layout.treeWidth')).toEqual({ v: 1, value: 240 });

  const second = await h.restart();
  await setContentSize(second.app, second.page, 1280, 800);
  const width2 = await second.page.getByRole('navigation', { name: 'Notes' }).evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(width2 - 240)).toBeLessThanOrEqual(1);

  // A closed tree stays closed across relaunch.
  await second.page.keyboard.press('Control+Backslash');
  await expect(second.page.getByRole('navigation', { name: 'Notes' })).toHaveCount(0);
  await expect.poll(() => h.setting('layout.treeOpen')).toEqual({ v: 1, value: false });
  const third = await h.restart();
  await expect(third.page.getByRole('navigation', { name: 'Notes' })).toHaveCount(0);
});

test('panel toggle', async () => {
  const { app, page } = await h.start();
  await setContentSize(app, page, 1280, 800);
  const panel = page.getByRole('complementary', { name: 'Details' });
  await expect(panel).toBeVisible();
  const w = (await panel.boundingBox())!.width;
  expect(w).toBeGreaterThanOrEqual(280);
  expect(w).toBeLessThanOrEqual(340);
  await expect(panel.getByText('Open a note to see its details')).toBeVisible();

  const a = await createNote(page, COMMON, 'Panel note A');
  const b = await createNote(page, COMMON, 'Panel note B');
  await reloadUi(page);
  await openByPalette(page, 'Panel note A');
  await expect(panel.locator('dd').first()).toHaveText('Panel note A');
  for (const term of ['Title', 'Location', 'Type', 'Revision']) await expect(panel.locator('dt', { hasText: new RegExp(`^${term}$`) })).toBeVisible();
  await expect(panel.getByRole('switch', { name: 'Pinned to Home' })).toBeVisible();
  await expect(panel.getByRole('switch', { name: 'Favorite' })).toBeVisible();

  // Info follows the active note.
  await openByPalette(page, 'Panel note B');
  await expect(panel.locator('dd').first()).toHaveText('Panel note B');

  // The pinned switch writes notes.pinned_at for this note only.
  await activate(panel.getByRole('switch', { name: 'Pinned to Home' }));
  await expect(panel.getByRole('switch', { name: 'Pinned to Home' })).toHaveAttribute('aria-checked', 'true');
  expect(h.one<{ pinned_at: number | null }>('SELECT pinned_at FROM notes WHERE id = ?', b)?.pinned_at).not.toBeNull();
  expect(h.one<{ pinned_at: number | null }>('SELECT pinned_at FROM notes WHERE id = ?', a)?.pinned_at).toBeNull();

  await activate(page.getByRole('button', { name: /Toggle details panel/ }));
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('Control+Shift+Backslash');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Control+Shift+Backslash');
  await expect(panel).toHaveCount(0);
  await expect.poll(() => h.setting('layout.panelOpen')).toEqual({ v: 1, value: false });
  const again = await h.restart();
  await setContentSize(again.app, again.page, 1280, 800);
  await expect(again.page.getByRole('complementary', { name: 'Details' })).toHaveCount(0);
});

test('narrow 760x560 drawers', async () => {
  const { app, page } = await h.start();
  const note = await createNote(page, COMMON, 'Drawer note');
  await reloadUi(page);
  await setContentSize(app, page, 760, 560);
  await expect(page.getByRole('navigation', { name: 'Notes' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Details' })).toHaveCount(0);

  const notesButton = primaryNav(page).getByRole('button', { name: 'Notes', exact: true });
  await activate(notesButton);
  const drawer = page.getByRole('dialog', { name: 'Notes' });
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate((el) => (el as HTMLDialogElement).open)).toBe(true);
  await expect(drawer.getByRole('treeitem').first()).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('treeitem');
  await drawer.locator(`[id="tree-note:${note}"]`).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Drawer note' })).toBeVisible();
  await expect(drawer).toHaveCount(0);

  // Right drawer: opens with the shortcut, Escape closes it and focus returns to the invoker.
  const toggle = page.getByRole('button', { name: /Toggle details panel/ });
  await toggle.focus();
  await page.keyboard.press('Control+Shift+Backslash');
  const details = page.getByRole('dialog', { name: 'Details' });
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(toggle).toBeFocused();

  // Left drawer: Escape returns focus to the Notes rail button.
  await notesButton.focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(notesButton).toBeFocused();

  await setContentSize(app, page, 1100, 720);
  await expect(page.getByRole('navigation', { name: 'Notes' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Details' })).toHaveCount(0);
  await page.keyboard.press('Control+Shift+Backslash');
  await expect(page.getByRole('dialog', { name: 'Details' })).toBeVisible();
});

test('breakpoints', async () => {
  const { app, page } = await h.start();
  const treeDocked = () => page.getByRole('navigation', { name: 'Notes' }).count();
  const panelDocked = () => page.getByRole('complementary', { name: 'Details' }).count();
  await setContentSize(app, page, 959, 700);
  await expect.poll(treeDocked).toBe(0);
  await setContentSize(app, page, 960, 700);
  await expect.poll(treeDocked).toBe(1);
  await setContentSize(app, page, 1179, 700);
  await expect.poll(panelDocked).toBe(0);
  await setContentSize(app, page, 1180, 700);
  await expect.poll(panelDocked).toBe(1);
});

test('theme follows OS', async () => {
  const { page } = await h.start();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(23, 24, 29)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)');

  await railGo(page, 'Settings');
  await activate(page.getByRole('radio', { name: 'Dark' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(23, 24, 29)');
  await expect.poll(() => h.setting('appearance.theme')).toEqual({ v: 1, value: 'dark' });
});

test('visible focus', async () => {
  const { app, page } = await h.start();
  await setContentSize(app, page, 1100, 720);
  await createProject(page, 'Focus project');
  await reloadUi(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, width: cs.outlineWidth, style: cs.outlineStyle, offset: cs.outlineOffset, color: cs.outlineColor };
  });
  expect(first.tag).not.toBe('BODY');
  expect(first).toMatchObject({ style: 'solid', width: '2px', offset: '2px', color: 'rgb(106, 90, 224)' });

  // Rail buttons use offset 2px; tree rows and tabs use -2px.
  const rail = primaryNav(page).getByRole('button', { name: 'Home', exact: true });
  await rail.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(rail).toBeFocused();
  expect(await rail.evaluate((el) => getComputedStyle(el).outlineOffset)).toBe('2px');
  const row = page.getByRole('treeitem').first();
  await row.focus();
  expect(await row.evaluate((el) => ({ w: getComputedStyle(el).outlineWidth, s: getComputedStyle(el).outlineStyle, o: getComputedStyle(el).outlineOffset }))).toEqual({ w: '2px', s: 'solid', o: '-2px' });
  const tab = tabs(page).first();
  await tab.focus();
  expect(await tab.evaluate((el) => getComputedStyle(el).outlineOffset)).toBe('-2px');
  await expect.poll(() => tabLabels(page)).toEqual(['Home']);
});

test('reloading the renderer leaves no extra main-process listeners', async () => {
  const { app, page } = await h.start();
  const counts = () =>
    app.evaluate(({ BrowserWindow, ipcMain }) => {
      const wc = BrowserWindow.getAllWindows()[0]!.webContents;
      return {
        webContentsEvents: Object.fromEntries(wc.eventNames().map((n) => [String(n), wc.listenerCount(n)])),
        ipcMainEvents: Object.fromEntries(ipcMain.eventNames().map((n) => [String(n), ipcMain.listenerCount(n)])),
      };
    });
  const before = await counts();
  for (let i = 0; i < 3; i += 1) await reloadUi(page);
  const after = await counts();
  expect(after).toEqual(before);

  // Exactly one live subscriber: a bridge mutation reloads the tree once and shows the new project once.
  const id = await createProject(page, 'Listener probe');
  await expect(page.locator('[id="tree-project:' + id + '"]')).toHaveCount(1);
  expect(await page.locator('[role="treeitem"]').filter({ hasText: 'Listener probe' }).count()).toBe(1);
});
