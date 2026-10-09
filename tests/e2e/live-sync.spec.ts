import { expect, test, type Page } from '@playwright/test';
import { editor, editorText } from './editor-ui';
import { useApp } from './harness';
import { COMMON, createNote, reloadUi, saveText } from './seed';
import { floatFromTab, stickyNoteIds, stickyPage } from './sticky-ui';
import { openFromTree } from './ui';

const h = useApp();

const plainText = (id: string) => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', id)!.plain_text;
const draftCount = () => h.all('SELECT id FROM note_drafts').length;

async function typeAtEnd(page: Page, text: string): Promise<void> {
  await editor(page).focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(text);
}

/** A note open in a tab and floated as a sticky: two views of it in two windows. */
async function openTwice(text: string) {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Together');
  await saveText(page, id, text);
  await reloadUi(page);
  await openFromTree(page, id);
  await expect.poll(() => editorText(page)).toBe(text);
  await floatFromTab(page);
  const sp = await stickyPage(app, id);
  await expect.poll(() => editorText(sp)).toBe(text);
  return { app, page, sp, id };
}

test('typing in the tab shows in the sticky and typing in the sticky shows in the tab, both editable (INF-STKY-07, D-103)', async () => {
  const { page, sp, id } = await openTwice('start');
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await expect(editor(sp)).toHaveAttribute('contenteditable', 'true');
  await expect(page.getByText('This note is being edited in another window')).toHaveCount(0);

  await typeAtEnd(page, ' from the tab');
  await expect.poll(() => editorText(sp)).toBe('start from the tab');
  await typeAtEnd(sp, ' and the sticky');
  await expect.poll(() => editorText(page)).toBe('start from the tab and the sticky');
  await expect.poll(() => plainText(id)).toBe('start from the tab and the sticky');
  expect(draftCount()).toBe(0);
});

test('typing in both at the same time converges in both views and in the stored note (INF-STKY-07, D-103)', async () => {
  const { page, sp, id } = await openTwice('middle');
  await editor(page).focus();
  await page.keyboard.press('Control+Home');
  await editor(sp).focus();
  await sp.keyboard.press('Control+End');
  // Interleaved key by key in the two windows.
  await Promise.all([page.keyboard.type('tab tab tab ', { delay: 25 }), sp.keyboard.type(' sticky sticky sticky', { delay: 25 })]);
  const expected = 'tab tab tab middle sticky sticky sticky';
  await expect.poll(() => editorText(page)).toBe(expected);
  await expect.poll(() => editorText(sp)).toBe(expected);
  await expect.poll(() => plainText(id)).toBe(expected);
  // Alternating turns keep converging.
  for (const [view, word] of [[page, ' one'], [sp, ' two'], [page, ' three'], [sp, ' four']] as const) await typeAtEnd(view, word);
  await expect.poll(() => editorText(page)).toBe(`${expected} one two three four`);
  await expect.poll(() => editorText(sp)).toBe(`${expected} one two three four`);
  await expect.poll(() => plainText(id)).toBe(`${expected} one two three four`);
  expect(draftCount()).toBe(0);

  const second = await h.restart();
  await expect.poll(() => editorText(second.page)).toBe(`${expected} one two three four`);
});

test('closing the sticky right after typing loses nothing (D-072, D-103)', async () => {
  const { app, page, sp, id } = await openTwice('keep');
  await editor(sp).focus();
  await sp.keyboard.press('Control+End');
  await sp.keyboard.insertText(' every word');
  // Ctrl+W hides the sticky when the key is released, within the save delay.
  await sp.keyboard.press('Control+W');
  await expect.poll(() => stickyNoteIds(app)).toEqual([]);
  await expect.poll(() => plainText(id)).toBe('keep every word');
  await expect.poll(() => editorText(page)).toBe('keep every word');
  expect(draftCount()).toBe(0);
  // The tab goes on editing alone.
  await typeAtEnd(page, '!');
  await expect.poll(() => plainText(id)).toBe('keep every word!');
});
