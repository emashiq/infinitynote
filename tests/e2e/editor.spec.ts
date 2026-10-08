import { expect, test } from '@playwright/test';
import { useApp } from './harness';
import { COMMON, createNote, reloadUi } from './seed';
import { activeTabLabel, openFromTree, tabItem, tabLabels, titleInput } from './ui';

const h = useApp();

interface NoteRow {
  id: string;
  revision: number;
  content_json: string;
  plain_text: string;
  title: string;
  deleted_at: number | null;
}
const noteRow = (id: string) => h.one<NoteRow>('SELECT id, revision, content_json, plain_text, title, deleted_at FROM notes WHERE id = ?', id)!;

test('flush on close', async () => {
  const { page } = await h.start();
  const d = await createNote(page, COMMON, 'Flush D');
  await reloadUi(page);
  await openFromTree(page, d);
  const text = page.getByLabel('Note text');
  await expect(text).toBeVisible();
  const before = noteRow(d).revision;

  // Typing and closing inside the 400 ms debounce window must still persist the text.
  await text.fill('flush me');
  await page.keyboard.press('Control+W');
  await expect(tabItem(page, 'Flush D')).toHaveCount(0);
  await expect.poll(() => noteRow(d).revision).toBe(before + 1);
  expect(noteRow(d).content_json).toContain('flush me');
  expect(noteRow(d).plain_text).toContain('flush me');
  expect(noteRow(d).deleted_at).toBeNull();

  await h.restart();
  await openFromTree(h.page, d);
  await expect(h.page.getByLabel('Note text')).toHaveValue('flush me');
});

test('text area save increments revision and survives relaunch', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'Stable id note');
  await reloadUi(page);
  await openFromTree(page, id);
  const text = page.getByLabel('Note text');
  await text.fill('first line\n\nthird line after an empty line\nপ্রথম লাইন');
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect.poll(() => noteRow(id).revision).toBe(1);

  await text.fill('first line\n\nthird line after an empty line\nপ্রথম লাইন\nmore');
  await expect.poll(() => noteRow(id).revision).toBe(2);
  expect(JSON.parse(noteRow(id).content_json).type).toBe('doc');
  expect(noteRow(id).plain_text).toContain('more');

  // Renaming through the title field keeps the revision unchanged by rename and the id stable.
  const title = titleInput(page);
  await title.fill('Renamed by title field');
  await title.press('Enter');
  await expect.poll(() => noteRow(id).title).toBe('Renamed by title field');
  await expect(tabItem(page, 'Renamed by title field')).toBeVisible();
  await expect(text).toBeFocused();

  const second = await h.restart();
  expect(await tabLabels(second.page)).toEqual(['Home', 'Renamed by title field']);
  expect(await activeTabLabel(second.page)).toBe('Renamed by title field');
  await expect(second.page.getByLabel('Note text')).toHaveValue('first line\n\nthird line after an empty line\nপ্রথম লাইন\nmore');
  expect(h.all('SELECT id FROM notes').map((r) => (r as { id: string }).id)).toEqual([id]);
});
