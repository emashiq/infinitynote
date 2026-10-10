import { expect, test } from '@playwright/test';
import { useApp } from './harness';
import { blockedRequests, editor, focusEditorEnd, waitSaved } from './editor-ui';
import { COMMON, createNote, reloadUi } from './seed';
import { openByPalette } from './ui';

/**
 * Mermaid diagrams and code highlighting (F7, F11.1, D-158, D-159) under the real CSP: the drawing appears, invalid source
 * shows the error, nothing is fetched. Written in Run 5; runs in WSL under Xvfb and on CI only.
 */
const h = useApp({ failOnMainErrors: true });

test('"/diagram" inserts a flowchart that is drawn as an image; Edit shows its source and a syntax error is reported', async () => {
  const { app, page } = await h.start();
  const note = await createNote(page, COMMON, 'Flow');
  await reloadUi(page);
  await openByPalette(page, 'Flow');
  await focusEditorEnd(page);
  await page.keyboard.type('/diagram');
  await page.keyboard.press('Enter');
  const block = editor(page).locator('.code-block.is-diagram');
  await expect(block.getByRole('img', { name: 'Diagram' })).toBeVisible({ timeout: 15_000 });
  await waitSaved(page);
  expect(h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', note)!.plain_text).toContain('flowchart TD');

  // The new block has the cursor, so its source shows: Preview hides it, Edit shows it again.
  await block.getByRole('button', { name: 'Preview' }).click();
  await expect(block.locator('pre')).toHaveClass('is-hidden');
  await block.getByRole('button', { name: 'Edit' }).click();
  await expect(block.locator('pre')).not.toHaveClass('is-hidden');
  await block.locator('pre code').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n  oops -->');
  await expect(block.locator('.diagram-error')).toBeVisible({ timeout: 15_000 });
  await expect(block.getByRole('button', { name: 'Copy as SVG' })).toHaveCount(0);
  expect(await blockedRequests(app)).toEqual([]);
});

test('a code block in a known language is highlighted and its language can be changed', async () => {
  const { page } = await h.start();
  await createNote(page, COMMON, 'Code');
  await reloadUi(page);
  await openByPalette(page, 'Code');
  await focusEditorEnd(page);
  // A fence becomes a code block at the space after it (letters right after it would name its language).
  await page.keyboard.type('``` ');
  await page.keyboard.type('const x = 1;');
  const picker = editor(page).getByRole('combobox', { name: 'Code language' });
  await picker.selectOption('javascript');
  await expect(editor(page).locator('.hljs-keyword').first()).toHaveText('const');
});
