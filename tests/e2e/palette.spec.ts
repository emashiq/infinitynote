import { expect, test } from '@playwright/test';
import { useApp } from './harness';
import { createFolder, createNote, createProject, reloadUi } from './seed';
import { activeTabLabel, dialogByName, primaryNav, tabs } from './ui';

const h = useApp();

test('actions and titles', async () => {
  const { page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const beta = await createProject(page, 'Beta');
  const specs = await createFolder(page, { projectId: alpha, parentId: null }, 'Specs');
  await createNote(page, { projectId: alpha, folderId: specs }, 'Plan');
  await createNote(page, { projectId: beta, folderId: null }, 'Plan');
  await reloadUi(page);

  // Focus returns to the element that had it before the palette opened.
  const before = primaryNav(page).getByRole('button', { name: 'Settings', exact: true });
  await before.focus();
  await page.keyboard.press('Control+K');
  const palette = dialogByName(page, 'Command palette');
  await expect(palette).toBeVisible();
  const input = palette.getByRole('combobox');
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
  expect(await activeTabLabel(page)).toBe('Plan');
  await expect(tabs(page)).toHaveCount(2);
  const secondPath = second!.includes('Alpha') ? 'Alpha › Specs' : 'Beta';
  await expect(page.getByRole('main').getByText(secondPath, { exact: true }).first()).toBeVisible();

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
