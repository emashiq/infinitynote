import { expect, test } from '@playwright/test';
import { useApp } from './harness';
import { editorText, focusEditorEnd } from './editor-ui';
import { COMMON, createFolder, createNote, createProject, reloadUi, saveText } from './seed';
import { activeTabLabel, dialogByName, openByPalette, primaryNav, tabs } from './ui';

const h = useApp();

test('actions and titles', async () => {
  const { page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const beta = await createProject(page, 'Beta');
  const specs = await createFolder(page, { projectId: alpha, parentId: null }, 'Specs');
  // Same title, different text: the note view shows only the text (D-102), so the text tells which note opened.
  const bodies = { 'Alpha › Specs': 'Written in Specs', Beta: 'Written in Beta' };
  await saveText(page, await createNote(page, { projectId: alpha, folderId: specs }, 'Plan'), bodies['Alpha › Specs']);
  await saveText(page, await createNote(page, { projectId: beta, folderId: null }, 'Plan'), bodies.Beta);
  await reloadUi(page);

  // Focus returns to the element that had it before the palette opened.
  const before = primaryNav(page).getByRole('button', { name: 'Settings', exact: true });
  await before.focus();
  await page.keyboard.press('Control+K');
  const palette = dialogByName(page, 'Command palette');
  await expect(palette).toBeVisible();
  const input = palette.getByRole('combobox', { name: 'Type a command or search notes' });
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await expect(before).toBeFocused();

  // Actions: "new pro" selects New project and Enter opens its dialog.
  await page.keyboard.press('Control+K');
  await input.fill('new pro');
  await expect(palette.getByRole('option').first()).toHaveText(/New project/);
  await expect(palette.getByRole('option', { selected: true })).toHaveText(/New project/);
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(dialogByName(page, 'New project')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialogByName(page, 'New project')).toHaveCount(0);

  // Titles: both "Plan" notes are listed with their paths; Down + Enter opens the second.
  await page.keyboard.press('Control+K');
  await input.fill('Plan');
  const options = palette.getByRole('option');
  await expect(options.filter({ hasText: 'Plan' })).toHaveCount(2);
  const texts = (await options.allTextContents()).join('|');
  expect(texts).toContain('Alpha › Specs');
  expect(texts).toContain('Beta');
  await page.keyboard.press('ArrowDown');
  const second = await options.nth(1).textContent();
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect.poll(() => activeTabLabel(page)).toBe('Plan');
  await expect(tabs(page)).toHaveCount(2);
  const secondPath = second!.includes('Alpha') ? 'Alpha › Specs' : 'Beta';
  await expect.poll(() => editorText(page)).toBe(bodies[secondPath]);

  // Choosing the already-open note again keeps one tab.
  await page.keyboard.press('Control+K');
  await input.fill('Plan');
  await expect(options.filter({ hasText: 'Plan' })).toHaveCount(2);
  const selected = palette.getByRole('option', { selected: true });
  for (let i = 0; i < 2 && !(await selected.textContent())!.includes(secondPath); i += 1) await page.keyboard.press('ArrowDown');
  await expect(selected).toContainText(secondPath);
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(2);
});

test('open with pending edit: the palette opens the exact note tab and no typed text is lost (INF-SRCH-06)', async () => {
  const { page } = await h.start();
  const alpha = await createNote(page, COMMON, 'Alpha note');
  await createNote(page, COMMON, 'Beta note');
  await reloadUi(page);
  await openByPalette(page, 'Alpha note');
  await focusEditorEnd(page);
  // Typed and switched away at once, before the lazy save runs.
  await page.keyboard.insertText('unsaved words');
  await page.keyboard.press('Control+K');
  const palette = dialogByName(page, 'Command palette');
  const input = palette.getByRole('combobox', { name: 'Type a command or search notes' });
  await input.fill('Beta note');
  await expect(palette.getByRole('option').filter({ hasText: 'Beta note' })).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect.poll(() => activeTabLabel(page)).toBe('Beta note');
  await expect.poll(() => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', alpha)!.plain_text).toBe('unsaved words');

  // Full-text: a word of the body finds the note; Enter activates its existing tab, with the text in place.
  await page.keyboard.press('Control+K');
  await input.fill('unsaved');
  const hit = palette.getByRole('option').filter({ hasText: 'Alpha note' });
  await expect(hit.locator('mark')).toHaveText(['unsaved']);
  await page.keyboard.press('Enter');
  await expect.poll(() => activeTabLabel(page)).toBe('Alpha note');
  await expect(tabs(page)).toHaveCount(3);
  expect(await editorText(page)).toBe('unsaved words');
});
