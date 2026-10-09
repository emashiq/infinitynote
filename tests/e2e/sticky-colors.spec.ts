import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { docOf, editor, nodesOf, openFormatting, toolbarButton } from './editor-ui';
import { useApp } from './harness';
import { COMMON, createFolder, createNote, createProject } from './seed';
import { pressClosing, stickyHeader, stickyPage, windowsOf } from './sticky-ui';
import { activate } from './ui';

/** v0.2.0: sticky header alignment, window color, custom colors and sticky text colors. */
const h = useApp({ failOnMainErrors: true });

async function floatSticky(page: Page, app: ElectronApplication, noteId: string): Promise<Page> {
  const res = await page.evaluate((id) => window.infinity.sticky.float({ noteId: id }), noteId);
  expect(res.ok).toBe(true);
  return stickyPage(app, noteId);
}

/** The native background color of the sticky window of a note (what shows before and around the page). */
async function windowBackground(app: ElectronApplication, noteId: string): Promise<string> {
  const info = (await windowsOf(app)).stickies.find((s) => s.noteId === noteId)!;
  return app.evaluate(({ BrowserWindow, webContents }, id) => BrowserWindow.fromWebContents(webContents.fromId(id)!)!.getBackgroundColor().toLowerCase(), info.webContentsId);
}

const noteColors = (id: string) => h.one<{ color: string; text_color: string | null }>('SELECT color, text_color FROM notes WHERE id = ?', id);
const computed = (page: Page, selector: string, property: 'color' | 'backgroundColor') =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p as 'color'], property);

test('the sticky header: title and project label on one center line, the label truncates first', async () => {
  const { app, page } = await h.start();
  const project = await createProject(page, 'RWI Reifa Infrastructure Program');
  const folder = await createFolder(page, { projectId: project, parentId: null }, 'Operations and maintenance');
  const id = await createNote(page, { projectId: project, folderId: folder }, 'Credential & VM Info');
  const sp = await floatSticky(page, app, id);
  const header = stickyHeader(sp);
  const g = await header.evaluate((el) => {
    const box = (sel: string) => el.querySelector(sel)!.getBoundingClientRect();
    const center = (r: DOMRect) => r.top + r.height / 2;
    const title = el.querySelector<HTMLInputElement>('.sticky-title-input')!;
    const badge = el.querySelector<HTMLElement>('.sticky-badge')!;
    return {
      header: center(el.getBoundingClientRect()),
      title: center(box('.sticky-title-input')),
      badge: center(box('.sticky-badge')),
      buttons: [...el.querySelectorAll('button')].map((b) => center(b.getBoundingClientRect())),
      gap: box('.sticky-badge').left - box('.sticky-title-input').right,
      titleFits: title.scrollWidth <= title.clientWidth + 1,
      badgeTruncated: badge.scrollWidth > badge.clientWidth,
      badgeTooltip: badge.title,
    };
  });
  expect(Math.abs(g.title - g.badge)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.title - g.header)).toBeLessThanOrEqual(1.5);
  for (const b of g.buttons) expect(Math.abs(b - g.header)).toBeLessThanOrEqual(1.5);
  expect(g.gap).toBeGreaterThanOrEqual(4);
  expect(g.titleFits).toBe(true);
  expect(g.badgeTruncated).toBe(true);
  expect(g.badgeTooltip).toBe('RWI Reifa Infrastructure Program › Operations and maintenance');
});

test('a custom sticky color and text color fill the whole window, are stored and come back', async () => {
  const { app, page } = await h.start();
  await page.evaluate(() => window.infinity.settings.set({ key: 'appearance.theme', value: 'light' }));
  const id = await createNote(page, COMMON, 'Colors', { sticky: true });
  let sp = await floatSticky(page, app, id);
  // The window and the page both show the sticky color.
  expect(await windowBackground(app, id)).toBe('#fff4b8');
  expect(await computed(sp, 'body', 'backgroundColor')).toBe('rgb(255, 244, 184)');

  await activate(stickyHeader(sp).getByRole('button', { name: 'Sticky color' }));
  const popover = sp.getByRole('dialog', { name: 'Sticky color' });
  await popover.getByRole('textbox', { name: 'Sticky color: custom color' }).fill('#7A1F3D');
  await popover.getByRole('textbox', { name: 'Sticky color: custom color' }).press('Enter');
  await expect.poll(() => noteColors(id)).toEqual({ color: '#7a1f3d', text_color: null });
  await expect.poll(() => windowBackground(app, id)).toBe('#7a1f3d');
  expect(await computed(sp, 'body', 'backgroundColor')).toBe('rgb(122, 31, 61)');
  // Automatic text on a dark custom color is white, in the header and in the text.
  expect(await computed(sp, '.sticky-title-input', 'color')).toBe('rgb(255, 255, 255)');
  expect(await computed(sp, '.note-editor-content', 'color')).toBe('rgb(255, 255, 255)');
  await expect(popover.getByRole('radiogroup', { name: 'Sticky color' }).getByRole('radio', { checked: true })).toHaveCount(0);

  const grayText = popover.getByRole('radiogroup', { name: 'Text color' }).getByRole('radio', { name: 'Gray' });
  await grayText.focus();
  await grayText.press('Enter');
  await expect.poll(() => noteColors(id)).toEqual({ color: '#7a1f3d', text_color: '#7a7f8c' });
  await expect.poll(() => computed(sp, '.note-editor-content', 'color')).toBe('rgb(122, 127, 140)');
  await sp.keyboard.press('Escape');
  await expect(popover).toBeHidden();

  // Selected sticky text gets its own color from the formatting toolbar, as in notes.
  await editor(sp).focus();
  await sp.keyboard.insertText('alert');
  await sp.keyboard.press('Control+A');
  await openFormatting(sp);
  const textColor = toolbarButton(sp, 'Text color');
  await textColor.focus();
  await textColor.press('Enter');
  const blue = sp.getByRole('dialog', { name: 'Text color' }).getByRole('radio', { name: 'Blue' });
  await blue.focus();
  await blue.press('Enter');
  await expect.poll(() => nodesOf(docOf(h, id)).find((n) => n.text === 'alert')?.marks?.[0]?.attrs?.color).toBe('#1c7ed6');

  // Hidden and floated again: the colors come from the database.
  await sp.keyboard.press('Escape');
  await pressClosing(stickyHeader(sp).getByRole('button', { name: 'Close sticky' }));
  await expect.poll(async () => (await windowsOf(app)).stickies.length).toBe(0);
  sp = await floatSticky(page, app, id);
  await expect(sp.locator('.sticky-window')).toHaveAttribute('data-sticky-color', '#7a1f3d');
  expect(await windowBackground(app, id)).toBe('#7a1f3d');
  expect(await computed(sp, '.note-editor-content', 'color')).toBe('rgb(122, 127, 140)');
  expect(await computed(sp, '.note-editor-content span[style]', 'color')).toBe('rgb(28, 126, 214)');

  // Back to a preset: its theme variant, and the window follows a theme change.
  await activate(stickyHeader(sp).getByRole('button', { name: 'Sticky color' }));
  const green = sp.getByRole('radiogroup', { name: 'Sticky color' }).getByRole('radio', { name: 'Green' });
  await green.focus();
  await green.press('Enter');
  await expect.poll(() => windowBackground(app, id)).toBe('#ddf5d8');
  await page.evaluate(() => window.infinity.settings.set({ key: 'appearance.theme', value: 'dark' }));
  await expect.poll(() => windowBackground(app, id)).toBe('#24402a');
  await expect.poll(() => computed(sp, 'body', 'backgroundColor')).toBe('rgb(36, 64, 42)');
});
