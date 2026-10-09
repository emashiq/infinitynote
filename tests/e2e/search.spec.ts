import { randomUUID } from 'node:crypto';
import { expect, test, type Locator } from '@playwright/test';
import { useApp } from './harness';
import { detailsPanel, withPanel } from './reminder-ui';
import { COMMON, createNote, createProject, favorite, pin, reloadUi, saveDoc } from './seed';
import { activeTabLabel, dialogByName, openByPalette } from './ui';

const h = useApp({ failOnMainErrors: true });

/** The palette's result options (not the options of its filter selects). */
const results = (palette: Locator) => palette.getByRole('listbox', { name: 'Results' }).getByRole('option');

const body = (text: string) => ({ type: 'doc' as const, content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text }] }] });

test('tag filter: tags added in the Details panel narrow palette search (INF-HIER-11, INF-SRCH-03)', async () => {
  const { app, page } = await h.start();
  const work = await createProject(page, 'Work');
  const a = await createNote(page, COMMON, 'Budget A');
  const b = await createNote(page, { projectId: work, folderId: null }, 'Budget B');
  await saveDoc(page, a, body('quarterly budget numbers'));
  await saveDoc(page, b, body('yearly budget numbers'));
  await reloadUi(page);
  await withPanel(app, page);

  await openByPalette(page, 'Budget A');
  const tagInput = detailsPanel(page).getByRole('textbox', { name: 'Tags' });
  await tagInput.fill('#Finance');
  await tagInput.press('Enter');
  const tagList = detailsPanel(page).getByRole('list', { name: 'Tags' });
  await expect(tagList).toHaveText('#finance');
  await tagInput.fill('two words');
  await tagInput.press(',');
  await expect(tagList.getByRole('listitem')).toHaveCount(2);
  await expect.poll(() => h.all('SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id ORDER BY t.name')).toEqual([{ name: 'finance' }, { name: 'two-words' }]);
  await detailsPanel(page).getByRole('button', { name: 'Remove tag two-words' }).click();
  await expect(tagList.getByRole('listitem')).toHaveCount(1);
  await tagInput.fill('a,b');
  await tagInput.press('Enter');
  await expect(detailsPanel(page).getByRole('alert')).toHaveText('Use 1-32 letters or digits without spaces');

  await page.keyboard.press('Control+K');
  const palette = dialogByName(page, 'Command palette');
  await palette.getByRole('combobox', { name: 'Type a command or search notes' }).fill('budget');
  const notes = results(palette).filter({ hasText: 'numbers' });
  await expect(notes).toHaveCount(2);
  await palette.getByRole('button', { name: 'Filters' }).click();
  await palette.getByRole('combobox', { name: 'Tag' }).selectOption('finance');
  await expect(notes).toHaveCount(1);
  await expect(notes).toContainText('Budget A');
  await palette.getByRole('combobox', { name: 'Tag' }).selectOption('');
  await palette.getByRole('combobox', { name: 'Search in' }).selectOption({ label: 'Work' });
  await expect(notes).toHaveCount(1);
  await expect(notes).toContainText('Budget B');
  await palette.getByRole('combobox', { name: 'Search in' }).selectOption({ label: 'Common' });
  await expect(notes).toHaveCount(1);
  await expect(notes).toContainText('Budget A');
  await expect(palette.getByRole('button', { name: 'Filters (1)' })).toBeVisible();
});

test('highlighted snippets: body hits are marked and note markup is shown as text (INF-SRCH-01, INF-SRCH-04)', async () => {
  const { page } = await h.start();
  const note = await createNote(page, COMMON, 'Payload');
  await saveDoc(page, note, body('<img src=x onerror="window.__pwned=1"> zeppelin route <b>bold</b>'));
  const bangla = await createNote(page, COMMON, 'বাংলা নোট');
  await saveDoc(page, bangla, body('আমার সোনার বাংলা'));
  await reloadUi(page);

  await page.keyboard.press('Control+K');
  const palette = dialogByName(page, 'Command palette');
  const input = palette.getByRole('combobox', { name: 'Type a command or search notes' });
  await input.fill('zepp');
  const result = results(palette).filter({ hasText: 'Payload' });
  await expect(result.locator('mark')).toHaveText(['zeppelin']);
  await expect(result).toContainText('<img src=x onerror="window.__pwned=1"> zeppelin route <b>bold</b>');
  await expect(result.locator('img, b')).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();

  await input.fill('সোনা');
  const found = results(palette).filter({ hasText: 'বাংলা নোট' });
  await expect(found.locator('mark')).toHaveText(['সোনার']);
  await page.keyboard.press('Enter');
  await expect.poll(() => activeTabLabel(page)).toBe('বাংলা নোট');
});

test('pinned and favorite notes are offered before anything is typed (INF-SRCH-06)', async () => {
  const { page } = await h.start();
  const pinned = await createNote(page, COMMON, 'Pinned plan');
  const fav = await createNote(page, COMMON, 'Favorite list');
  await pin(page, pinned);
  await favorite(page, 'note', fav);
  await reloadUi(page);
  await page.keyboard.press('Control+K');
  const palette = dialogByName(page, 'Command palette');
  const options = results(palette);
  await expect(options.first()).toContainText('Pinned plan');
  await expect(options.nth(1)).toContainText('Favorite list');
  await expect(palette.locator('.group-label')).toHaveText(['Pinned', 'Favorites', 'Actions']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => activeTabLabel(page)).toBe('Favorite list');
});
