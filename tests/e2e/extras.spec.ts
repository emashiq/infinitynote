import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { useApp } from './harness';
import { editor, focusEditorEnd, paletteAction } from './editor-ui';
import { queueSave } from './portability-ui';
import { detailsPanel, withPanel } from './reminder-ui';
import { COMMON, createNote, reloadUi, saveDoc } from './seed';
import { openByPalette, toasts } from './ui';

/**
 * Short extras (F11.2-F11.5, D-161..D-163): math, outline, counts, export to PDF and HTML. Written in Run 5; runs in WSL
 * under Xvfb and on CI only. The print dialog itself is not opened by tests.
 */
const h = useApp({ failOnMainErrors: true });

const heading = (level: number, text: string) => ({ type: 'heading', attrs: { id: randomUUID(), level }, content: [{ type: 'text', text }] });
const para = (text: string) => ({ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text }] });

test('math: $…$ becomes a formula drawn by KaTeX, and $$ opens a block', async () => {
  const { page } = await h.start();
  const note = await createNote(page, COMMON, 'Physics');
  await reloadUi(page);
  await openByPalette(page, 'Physics');
  await focusEditorEnd(page);
  await page.keyboard.type('Energy $E=mc^2$ ');
  await expect(editor(page).locator('.math-inline .katex')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('$$ ');
  await expect(editor(page).getByRole('textbox', { name: 'Formula (TeX)' })).toBeFocused();
  await page.keyboard.type('\\int_0^1 x\\,dx');
  await page.keyboard.press('Control+Enter');
  await expect(editor(page).locator('.math-block .katex-display')).toBeVisible();
  await expect.poll(() => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', note)!.plain_text).toContain('E=mc^2');
});

test('outline and counts follow the note; a heading in the outline moves the cursor to it', async () => {
  const { app, page } = await h.start();
  const note = await createNote(page, COMMON, 'Guide');
  await saveDoc(page, note, { type: 'doc', content: [heading(1, 'Intro'), para('one two three'), heading(2, 'Setup'), para('four five')] });
  await reloadUi(page);
  await openByPalette(page, 'Guide');
  await expect(page.getByLabel('Note statistics')).toHaveText('7 words · 32 characters · 1 min read');
  await withPanel(app, page);
  const outline = detailsPanel(page).getByRole('list', { name: 'Outline' });
  await expect(outline.getByRole('button')).toHaveText(['Intro', 'Setup']);
  await outline.getByRole('button', { name: 'Setup' }).click();
  await page.keyboard.type('X');
  await expect(editor(page).getByRole('heading', { name: 'XSetup' })).toBeVisible();
});

test('export as PDF writes a PDF made in a hidden window, and export as HTML a page without scripts', async () => {
  const { app, page } = await h.start();
  const note = await createNote(page, COMMON, 'Report');
  await saveDoc(page, note, { type: 'doc', content: [heading(1, 'Summary'), para('All good')] });
  await reloadUi(page);
  await openByPalette(page, 'Report');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-export-'));
  const pdf = path.join(dir, 'Report.pdf');
  await queueSave(app, pdf);
  await paletteAction(page, 'Export note as PDF…');
  await expect(toasts(page).filter({ hasText: 'Exported to Report.pdf' })).toBeVisible();
  expect(fs.readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length)).toBe(1);

  const html = path.join(dir, 'Report.html');
  await queueSave(app, html);
  await paletteAction(page, 'Export note as HTML…');
  await expect(toasts(page).filter({ hasText: 'Exported to Report.html' })).toBeVisible();
  const page1 = fs.readFileSync(html, 'utf8');
  expect(page1).toContain('<h1>Summary</h1>');
  expect(page1).not.toMatch(/<script/i);
});
