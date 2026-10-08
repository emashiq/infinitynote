import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { closeApp, launchApp, makeUserDataDir, removeDir, repoRoot, setContentSize, type Launched } from './fixtures';
import { createNote, reloadUi, seedNotebook, type Notebook } from './seed';
import { activate, railGo, tabItem, treeByKey, titleInput } from './ui';

const SHOTS = process.env.INFINITY_SCREENSHOT_DIR ?? path.join(repoRoot, 'test-results', 'screens');
let userData = '';
let launched: Launched | null = null;

test.beforeEach(() => {
  userData = makeUserDataDir();
  fs.mkdirSync(SHOTS, { recursive: true });
});

test.afterEach(async () => {
  await closeApp(launched?.app);
  launched = null;
  await removeDir(userData);
});

async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file });
  expect(fs.existsSync(file)).toBe(true);
  expect(fs.statSync(file).size).toBeGreaterThan(10_000);
}

async function boot(): Promise<{ nb: Notebook; page: import('@playwright/test').Page; app: Launched['app'] }> {
  launched = await launchApp({ userDataDir: userData });
  const { app, page } = launched;
  const nb = await seedNotebook(page);
  await reloadUi(page);
  return { nb, page, app };
}

async function expandAlpha(page: import('@playwright/test').Page, nb: Notebook): Promise<void> {
  for (const key of [`project:${nb.alpha}`, `folder:${nb.l1}`, `folder:${nb.l2}`]) {
    const row = treeByKey(page, key);
    if ((await row.getAttribute('aria-expanded')) !== 'true') {
      await row.focus();
      await row.press('ArrowRight');
    }
  }
}

test('1100x720 light: home and note', async () => {
  const { app, page, nb } = await boot();
  await setContentSize(app, page, 1100, 720);
  await expandAlpha(page, nb);
  await shot(page, '1100x720-light-home.png');
  await page.getByRole('button', { name: /Launch plan/ }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Note text')).toHaveValue(/Ship the shell/);
  await expect(titleInput(page)).toHaveValue('Launch plan');
  await shot(page, '1100x720-light-note.png');
});

test('1100x720 dark', async () => {
  const { app, page } = await boot();
  await setContentSize(app, page, 1100, 720);
  await railGo(page, 'Settings');
  await activate(page.getByRole('radio', { name: 'Dark' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await railGo(page, 'Home');
  await shot(page, '1100x720-dark-home.png');
});

test('760x560 light: home and tree drawer', async () => {
  const { app, page } = await boot();
  await setContentSize(app, page, 760, 560);
  await shot(page, '760x560-light-home.png');
  await railGo(page, 'Notes');
  await expect(page.getByRole('dialog', { name: 'Notes' })).toBeVisible();
  await shot(page, '760x560-light-tree-drawer.png');
});

test('1280x800 light: details panel', async () => {
  const { app, page, nb } = await boot();
  await setContentSize(app, page, 1280, 800);
  await page.getByRole('button', { name: /Launch plan/ }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Details' }).getByText('Launch plan')).toBeVisible();
  await expandAlpha(page, nb);
  await shot(page, '1280x800-light-panel.png');
});

test('tab overflow and context menu', async () => {
  const { app, page, nb } = await boot();
  await setContentSize(app, page, 1100, 720);
  for (let i = 0; i < 14; i += 1) await createNote(page, { projectId: nb.alpha, folderId: null }, `Overflow note ${String(i + 1).padStart(2, "0")}`);
  await reloadUi(page);
  await page.keyboard.press('Control+K');
  for (let i = 0; i < 14; i += 1) {
    await page.getByRole('combobox').fill(`Overflow note ${String(i + 1).padStart(2, "0")}`);
    await expect(page.getByRole('option', { name: new RegExp(`Overflow note ${String(i + 1).padStart(2, '0')}`) }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(tabItem(page, `Overflow note ${String(i + 1).padStart(2, "0")}`)).toBeVisible();
    await page.keyboard.press('Control+K');
  }
  await page.keyboard.press('Escape');
  await shot(page, 'tab-overflow.png');
  const row = treeByKey(page, `project:${nb.alpha}`);
  await row.focus();
  await row.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await shot(page, 'context-menu.png');
});

test('focus ring', async () => {
  const { app, page } = await boot();
  await setContentSize(app, page, 1100, 720);
  await page.locator('body').click({ position: { x: 600, y: 300 } });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    return { label: el.getAttribute('aria-label'), width: cs.outlineWidth, style: cs.outlineStyle, offset: cs.outlineOffset, color: cs.outlineColor };
  });
  expect(outline.style).toBe('solid');
  expect(outline.width).toBe('2px');
  await shot(page, 'focus-ring.png');
});
