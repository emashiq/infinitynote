import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, setContentSize } from './fixtures';
import { useApp } from './harness';
import { makePng } from '../support/png';
import { createNote, importImage, reloadUi, saveDoc, saveText, seedNotebook, type Notebook } from './seed';
import { activate, openByPalette, openFromTree, railGo, tabItem, treeByKey, titleInput } from './ui';
import { editor, fakeView, findInput } from './editor-ui';
import { stickyHeader, stickyPage } from './sticky-ui';

const SHOTS = process.env.INFINITY_SCREENSHOT_DIR ?? path.join(repoRoot, 'test-results', 'screens');
const h = useApp();

test.beforeEach(() => {
  fs.mkdirSync(SHOTS, { recursive: true });
});

/** Saves a screenshot; a sticky window is small (and a collapsed one only a header), so its floor is lower. */
async function shot(page: Page, name: string, minBytes = 10_000): Promise<void> {
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file });
  expect(fs.existsSync(file)).toBe(true);
  expect(fs.statSync(file).size).toBeGreaterThan(minBytes);
}

async function boot(): Promise<{ nb: Notebook; page: Page; app: ElectronApplication }> {
  const { app, page } = await h.start();
  const nb = await seedNotebook(page);
  await reloadUi(page);
  return { nb, page, app };
}

async function expandAlpha(page: Page, nb: Notebook): Promise<void> {
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
  await expect(editor(page)).toHaveText(/Ship the shell/);
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

/** A rich note with every block kind, used by the Phase 03 editor screenshots. */
async function richNote(page: Page): Promise<string> {
  const id = await createNote(page, { projectId: null, folderId: null }, 'Editor tour');
  const image = await importImage(page, makePng(320, 140, [74, 144, 226, 255]), 'chart.png');
  await saveDoc(page, id, {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Launch plan' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ship the ' },
          { type: 'text', text: 'editor', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' with ' },
          { type: 'text', text: 'links', marks: [{ type: 'link', attrs: { href: 'https://example.com/docs' } }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'inline code', marks: [{ type: 'code' }] },
          { type: 'text', text: '.' },
        ],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Paste images' }] }] }] },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Block IDs' }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Find in note' }] }] },
        ],
      },
      { type: 'codeBlock', content: [{ type: 'text', text: 'const saved = await flush();' }] },
      { type: 'image', attrs: { attachmentId: image.id, width: 320, height: 140, alt: 'chart' } },
    ],
  });
  return id;
}

for (const theme of ['light', 'dark'] as const) {
  test(`1100x720 ${theme}: rich note`, async () => {
    const { app, page } = await h.start();
    const id = await richNote(page);
    await reloadUi(page);
    await setContentSize(app, page, 1100, 720);
    if (theme === 'dark') {
      await railGo(page, 'Settings');
      await activate(page.getByRole('radio', { name: 'Dark' }));
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    }
    await openFromTree(page, id);
    await expect.poll(() => editor(page).locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(320);
    await editor(page).locator('a').click();
    await expect(page.getByRole('group', { name: 'Link' })).toBeVisible();
    await shot(page, `1100x720-${theme}-rich-note.png`);
  });
}

test('1100x720 light: plain note', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, { projectId: null, folderId: null }, 'Plain list', { format: 'plain' });
  await saveText(page, id, 'eggs\nmilk\nবাংলা রুটি');
  await reloadUi(page);
  await setContentSize(app, page, 1100, 720);
  await openFromTree(page, id);
  await expect(editor(page)).toContainText('বাংলা রুটি');
  await shot(page, '1100x720-light-plain-note.png');
});

test('1100x720 light: conflict and read-only banners, find bar', async () => {
  const { app, page } = await h.start();
  const id = await richNote(page);
  await reloadUi(page);
  await setContentSize(app, page, 1100, 720);
  await openFromTree(page, id);
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' typed');
  await fakeView.forceWrite(app, id, 'Changed in another window', false);
  await expect(page.getByText('This note changed elsewhere. Your edits were kept as a recovered draft')).toBeVisible();
  await shot(page, '1100x720-light-conflict-banner.png');

  await page.keyboard.press('Control+F');
  await findInput(page).fill('window');
  await expect(page.locator('.find-count')).toHaveText('1 of 1');
  await shot(page, '1100x720-light-find-bar.png');
  await page.keyboard.press('Escape');

  expect(await fakeView.take(app, id)).toBe(true);
  await expect(page.getByText('This note is being edited in another window')).toBeVisible();
  await shot(page, '1100x720-light-read-only-banner.png');
});

test('760x560 light: editor toolbar', async () => {
  const { app, page } = await h.start();
  await richNote(page);
  await reloadUi(page);
  await setContentSize(app, page, 760, 560);
  await openByPalette(page, 'Editor tour');
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
  await expect(editor(page)).toContainText('Launch plan');
  await shot(page, '760x560-light-editor-toolbar.png');
});

/** Phase 04 screenshots: sticky windows, the Stickies page, Settings > Windows and tray and the tab Float button. */
async function floatedSticky(extraEnv?: Record<string, string>) {
  const { app, page } = await h.start(extraEnv);
  const nb = await seedNotebook(page);
  await saveText(page, nb.sticky, 'Call Maya about the venue\nBring the budget sheet');
  await page.evaluate((id) => window.infinity.sticky.float({ noteId: id }), nb.sticky);
  const sp = await stickyPage(app, nb.sticky);
  await expect(editor(sp)).toContainText('Call Maya about the venue');
  return { app, page, nb, sp };
}

test('sticky light, collapsed and color menu', async () => {
  const { sp } = await floatedSticky();
  await shot(sp, 'sticky-light.png', 3_000);
  await activate(stickyHeader(sp).getByRole('button', { name: 'Sticky color' }));
  await expect(sp.getByRole('menu', { name: 'Sticky color' })).toBeVisible();
  await shot(sp, 'sticky-color-menu.png', 3_000);
  await sp.keyboard.press('Escape');
  await activate(stickyHeader(sp).getByRole('button', { name: 'Collapse sticky' }));
  await expect(editor(sp)).toBeHidden();
  await shot(sp, 'sticky-collapsed.png', 500);
});

test('sticky dark', async () => {
  const { page, sp } = await floatedSticky();
  await page.evaluate(() => window.infinity.settings.set({ key: 'appearance.theme', value: 'dark' }));
  await expect(sp.locator('html')).toHaveAttribute('data-theme', 'dark');
  await shot(sp, 'sticky-dark.png', 3_000);
});

test('sticky read-only banner and trash state', async () => {
  const { page, nb, sp } = await floatedSticky();
  await openByPalette(page, 'Call Maya');
  await activate(page.getByRole('button', { name: 'Take edit control' }));
  await expect(sp.getByText('This note is being edited in another window')).toBeVisible();
  await shot(sp, 'sticky-read-only-banner.png', 3_000);
  await page.evaluate((id) => window.infinity.note.trash({ noteId: id }), nb.sticky);
  await expect(sp.getByRole('heading', { name: 'This note is in Trash' })).toBeVisible();
  await shot(sp, 'sticky-trash-state.png', 3_000);
});

test('sticky pin unsupported', async () => {
  const { sp } = await floatedSticky({ INFINITY_NOTES_TEST_CAPS: JSON.stringify({ alwaysOnTop: 'unsupported' }) });
  const pin = stickyHeader(sp).getByRole('button', { name: 'Keep on top' });
  await expect(pin).toHaveAttribute('aria-disabled', 'true');
  await pin.focus();
  await shot(sp, 'sticky-pin-unsupported.png', 3_000);
});

test('1100x720 light: stickies page, settings windows and tray, tab float button', async () => {
  const { app, page } = await boot();
  await setContentSize(app, page, 1100, 720);
  await railGo(page, 'Stickies');
  await expect(page.locator('.sticky-row')).toHaveCount(1);
  await shot(page, 'stickies-page.png');
  await railGo(page, 'Settings');
  await expect(page.getByRole('radiogroup', { name: 'When the main window closes' })).toBeVisible();
  await shot(page, 'settings-windows-and-tray.png');
  await openByPalette(page, 'Launch plan');
  await expect(titleInput(page)).toHaveValue('Launch plan');
  await page.getByRole('button', { name: 'Float as sticky' }).focus();
  await shot(page, 'tab-float-button.png');
});
