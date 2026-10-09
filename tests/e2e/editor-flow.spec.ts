import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { makePng } from '../support/png';
import {
  blockedRequests,
  blockIds,
  docOf,
  editor,
  editorSelectionText,
  editorText,
  nodesOf,
  paste,
  pressToolbar,
  queueDialog,
  seedClipboardHtml,
  seedClipboardImage,
  waitSaved,
} from './editor-ui';
import { waitForExit } from './fixtures';
import { useApp } from './harness';
import { dialogByName, openFromTree, titleInput } from './ui';

const h = useApp();

/** The phase demonstration: one real note edit, paste and reload, offline (Phase 03 acceptance). */
test('edit, paste and reload', async () => {
  const { app, page } = await h.start();
  const k = page.keyboard;
  await k.press('Control+N');
  await expect(titleInput(page)).toBeFocused();
  await k.insertText('Field notes বাংলা');
  await editor(page).click();
  await k.press('Control+Alt+1');
  await k.insertText('Plan');
  await k.press('Enter');
  await k.insertText('A ');
  await k.press('Control+B');
  await k.insertText('bold');
  await k.press('Control+B');
  await k.insertText(' and ');
  await k.press('Control+I');
  await k.insertText('italic');
  await k.press('Control+I');
  await k.insertText(' word');
  await k.press('Enter');
  await k.press('Control+Shift+8');
  await k.insertText('bullet item');
  await k.press('Enter');
  await k.press('Enter');
  await k.press('Control+Shift+9');
  await k.insertText('checked item');
  await k.press('Control+Enter');
  await k.press('Enter');
  await k.press('Enter');
  await k.insertText('site');
  for (let i = 0; i < 4; i += 1) await k.press('Shift+ArrowLeft');
  await expect.poll(() => editorSelectionText(page)).toBe('site');
  await pressToolbar(page, 'Link');
  const linkDialog = dialogByName(page, 'Link');
  await linkDialog.getByLabel('Address').fill('https://example.com/field');
  await linkDialog.getByLabel('Address').press('Enter');
  await expect(editor(page)).toBeFocused();
  // ArrowRight collapses the selection to its end on every platform (End does not on Linux with a selection).
  await k.press('ArrowRight');
  await expect.poll(() => editorSelectionText(page)).toBe('');
  await k.press('Enter');
  await pressToolbar(page, 'Code block');
  await expect(editor(page)).toBeFocused();
  await k.insertText('const field = 1;');
  await k.press('Control+Enter');
  await expect(editor(page).locator('pre')).toHaveCount(1);

  // Real clipboard bitmap, then real clipboard HTML with a script that must not run.
  await seedClipboardImage(app, makePng(64, 48));
  await paste(page);
  await expect.poll(() => editor(page).locator('img').first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(64);
  await seedClipboardHtml(app, '<p>pasted <b>html</b></p><script>window.__pwned = 1</script><img src="http://example.invalid/x.png" onerror="window.__pwned = 2">', 'pasted html');
  await paste(page);
  await expect(editor(page).getByText('pasted')).toBeVisible();
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();

  // Insert an image from a file, then delete the original file.
  const original = path.join(h.userData, 'from-disk.png');
  fs.writeFileSync(original, makePng(30, 20));
  await queueDialog(app, [original]);
  await pressToolbar(page, 'Insert image');
  await expect(editor(page).locator('img')).toHaveCount(2);
  fs.rmSync(original);

  // One undo and one redo bring the inserted image back.
  await editor(page).focus();
  await k.press('Control+Z');
  await expect(editor(page).locator('img')).toHaveCount(1);
  await k.press('Control+Y');
  await expect(editor(page).locator('img')).toHaveCount(2);
  await waitSaved(page);

  const id = h.one<{ id: string }>('SELECT id FROM notes')!.id;
  const proc = app.process();
  await app.evaluate(({ app: electronApp }) => {
    // On a fresh task, as closeApp does (F04-A2): never inside a statement an inspector interrupt paused.
    setImmediate(() => electronApp.quit());
  });
  expect(await waitForExit(proc, 15_000)).toBe(true);

  const second = await h.restart();
  const p = second.page;
  await openFromTree(p, id);
  await expect(titleInput(p)).toHaveValue('Field notes বাংলা');
  const e = editor(p);
  await expect(e.locator('h1')).toHaveText('Plan');
  await expect(e.locator('strong').first()).toHaveText('bold');
  await expect(e.locator('em')).toHaveText('italic');
  await expect(e.locator('ul:not([data-type]) li')).toHaveText('bullet item');
  await expect(e.locator('li[data-checked="true"] p')).toHaveText('checked item');
  await expect(e.locator('a[href="https://example.com/field"]')).toHaveText('site');
  await expect(e.locator('pre code')).toHaveText('const field = 1;');
  await expect(e.locator('a[href="http://example.invalid/x.png"]')).toHaveText('Image: example.invalid');
  await expect(e.locator('img')).toHaveCount(2);
  for (const width of await e.locator('img').evaluateAll((imgs) => Promise.all(imgs.map((i) => (i as HTMLImageElement).decode().then(() => (i as HTMLImageElement).naturalWidth))))) {
    expect(width).toBeGreaterThan(0);
  }
  expect(await editorText(p)).toContain('Plan');
  expect(await blockedRequests(second.app)).toEqual([]);
  const ids = blockIds(docOf(h, id));
  expect(ids.every((x) => typeof x === 'string')).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  expect(nodesOf(docOf(h, id)).filter((n) => n.type === 'image')).toHaveLength(2);
});
