import { expect, test, type Page } from '@playwright/test';
import { editor, waitSaved } from './editor-ui';
import { useApp } from './harness';
import { detailsPanel, withPanel } from './reminder-ui';
import { COMMON, createNote, reloadUi, saveDoc } from './seed';
import { openByPalette } from './ui';

/**
 * Comments (F8, D-165): a comment on selected note text with Ctrl+Alt+M, replies, resolve and reopen, "Text removed"
 * for an orphaned anchor, deleting with a confirmation, comments in search, and a comment on a spreadsheet cell.
 * Written in Run 6; runs in WSL under Xvfb and on CI (never on the Windows desktop).
 */
const h = useApp({ failOnMainErrors: true });

const P1 = '0b0b0b0b-0000-4000-8000-000000000001';
const comments = (page: Page) => detailsPanel(page).locator('.comments-section');

/**
 * Selects the first occurrence of `text` in the note and waits for the browser's selectionchange: the editor reads the
 * selection on that asynchronous event, so a shortcut pressed before it would see the old one.
 */
async function selectText(page: Page, text: string): Promise<void> {
  await editor(page).getByText(text, { exact: false }).first().click();
  await page.evaluate(async (needle) => {
    const announced = new Promise<void>((resolve) => document.addEventListener('selectionchange', () => setTimeout(resolve, 0), { once: true }));
    const root = document.querySelector('.note-editor-content')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = (n as Text).data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(n, at);
      range.setEnd(n, at + needle.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return announced;
    }
    throw new Error(`no text ${needle}`);
  }, text);
}

async function openPlan(page: Page): Promise<string> {
  const note = await createNote(page, COMMON, 'Plan');
  await saveDoc(page, note, { type: 'doc', content: [{ type: 'paragraph', attrs: { id: P1 }, content: [{ type: 'text', text: 'The budget is due on Friday' }] }] });
  await reloadUi(page);
  await openByPalette(page, 'Plan');
  return note;
}

test('Ctrl+Alt+M comments on the selection; the text is highlighted and the thread takes replies, resolve and reopen', async () => {
  const { app, page } = await h.start();
  await withPanel(app, page);
  const note = await openPlan(page);
  await selectText(page, 'budget');
  await page.keyboard.press('Control+Alt+M');
  const field = comments(page).getByRole('textbox', { name: 'New comment' });
  await expect(field).toBeFocused();
  await field.fill('Check the numbers');
  await page.keyboard.press('Control+Enter');
  await expect(editor(page).locator('.comment-anchor')).toHaveText('budget');
  await waitSaved(page);
  const [thread] = h.all<{ id: string; quote: string }>("SELECT id, quote FROM comment_threads WHERE target_kind = 'note' AND target_id = ?", note);
  expect(thread?.quote).toBe('budget');

  await comments(page).getByRole('button', { name: 'Reply' }).click();
  await comments(page).getByRole('textbox', { name: 'Reply' }).fill('Done');
  await comments(page).getByRole('button', { name: 'Reply' }).last().click();
  await expect(comments(page).locator('.comment-body')).toHaveText(['Check the numbers', 'Done']);

  await comments(page).getByRole('button', { name: 'Resolve' }).click();
  await expect(editor(page).locator('.comment-anchor')).toHaveCount(0);
  await comments(page).getByRole('radio', { name: /Resolved/ }).check();
  await comments(page).getByRole('button', { name: 'Reopen' }).click();
  await comments(page).getByRole('radio', { name: /Open/ }).check();
  await expect(editor(page).locator('.comment-anchor')).toHaveText('budget');
});

test('a thread whose text was removed shows "Text removed"; deleting it asks first and removes the mark', async () => {
  const { app, page } = await h.start();
  await withPanel(app, page);
  await openPlan(page);
  await selectText(page, 'Friday');
  await editor(page).press('Control+Alt+M');
  await comments(page).getByRole('textbox', { name: 'New comment' }).fill('Which Friday?');
  await page.keyboard.press('Control+Enter');
  await expect(editor(page).locator('.comment-anchor')).toHaveText('Friday');

  await selectText(page, 'Friday');
  await page.keyboard.press('Delete');
  await expect(comments(page).getByText('Text removed')).toBeVisible();
  await expect(comments(page).locator('.comment-quote')).toHaveText('Friday');

  await comments(page).getByRole('button', { name: 'Delete thread' }).click();
  await page.getByRole('dialog', { name: 'Delete this thread?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(comments(page).locator('.comment-thread')).toHaveCount(0);
  expect(h.all('SELECT id FROM comment_threads')).toEqual([]);
});

test('the bubble offers Comment, clicking a thread selects its text, and search finds the note by its comment', async () => {
  const { app, page } = await h.start();
  await withPanel(app, page);
  await openPlan(page);
  await selectText(page, 'due');
  await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Comment' }).click();
  await comments(page).getByRole('textbox', { name: 'New comment' }).fill('quarterly forecast deadline');
  await page.keyboard.press('Control+Enter');
  await comments(page).locator('.comment-anchor-btn').click();
  await expect(editor(page).locator('.comment-anchor-active')).toHaveText('due');

  await page.keyboard.press('Control+K');
  await page.getByRole('combobox').fill('quarterly forecast');
  await expect(page.getByRole('option', { name: /Plan/ })).toContainText('Comment:');
});

test('a spreadsheet cell takes a comment; the sidebar names the cell and opens the sheet at it', async () => {
  const { app, page } = await h.start();
  await withPanel(app, page);
  const res = await page.evaluate(() => window.infinity.document.create({ location: { projectId: null, folderId: null }, kind: 'xlsx', title: 'Budget' }));
  if (!res.ok) throw new Error(res.error.message);
  await reloadUi(page);
  await openByPalette(page, 'Budget');
  await page.locator('.fortune-sheet-container').waitFor();
  await page.mouse.click(300, 300);
  await openByPalette(page, 'Add comment');
  await comments(page).getByRole('textbox', { name: 'New comment' }).fill('Is this final?');
  await page.keyboard.press('Control+Enter');
  await expect(comments(page).locator('.comment-place')).toHaveText(/!/);
  expect(h.all<{ anchor_json: string }>('SELECT anchor_json FROM comment_threads')[0]!.anchor_json).toContain('"type":"cell"');
});
