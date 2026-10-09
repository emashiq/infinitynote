import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { makePng } from '../support/png';
import {
  blockedRequests,
  blockIds,
  chooseMore,
  docOf,
  dropFiles,
  editor,
  editorSelectionText,
  focusEditorEnd,
  nodesOf,
  paste,
  pressToolbar,
  queueDialog,
  saveStatus,
  seedClipboardHtml,
  seedClipboardImage,
  waitSaved,
} from './editor-ui';
import { useApp } from './harness';
import { COMMON, createNote, reloadUi, saveText } from './seed';
import { openFromTree, toasts } from './ui';

const h = useApp();
const MB = 1024 * 1024;

const attachments = () =>
  h.all<{ id: string; kind: string; mime: string; managed_relative_path: string; original_name: string | null; size_bytes: number }>(
    'SELECT id, kind, mime, managed_relative_path, original_name, size_bytes FROM attachments',
  );
const links = (noteId: string) => h.all<{ attachment_id: string; block_id: string | null }>('SELECT attachment_id, block_id FROM note_attachments WHERE note_id = ?', noteId);
const managedFile = (rel: string) => path.join(h.userData, 'data', rel);
const firstImage = (page: import('@playwright/test').Page) => editor(page).locator('img').first();
const naturalWidth = (page: import('@playwright/test').Page) => firstImage(page).evaluate((i: HTMLImageElement) => i.naturalWidth);

async function openNew(title: string) {
  const launched = await h.start();
  const id = await createNote(launched.page, COMMON, title);
  await reloadUi(launched.page);
  await openFromTree(launched.page, id);
  await focusEditorEnd(launched.page);
  return { ...launched, id };
}

test('copied blocks get new IDs (INF-EDIT-06)', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'Blocks');
  await saveText(page, id, 'first\nsecond');
  await reloadUi(page);
  await openFromTree(page, id);
  const domIds = () => editor(page).locator('p').evaluateAll((ps) => ps.map((p) => p.getAttribute('data-id')));
  // Both paragraphs exist and the editor's load-time ID pass has stamped them.
  await expect.poll(async () => (await domIds()).filter((x) => x !== null).length).toBe(2);
  const original = await domIds();
  await editor(page).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+End');
  await expect.poll(() => editorSelectionText(page)).toBe('');
  await page.keyboard.press('Enter');
  await paste(page);
  await expect(editor(page).locator('p')).toHaveCount(4);
  await waitSaved(page);
  await expect.poll(() => blockIds(docOf(h, id)).length).toBe(4);
  const stored = blockIds(docOf(h, id));
  expect(new Set(stored).size).toBe(4);
  expect(stored.every((x) => typeof x === 'string')).toBe(true);
  expect(stored.slice(0, 2)).toEqual(original);
  expect(nodesOf(docOf(h, id)).filter((n) => n.type === 'text').map((n) => n.text)).toEqual(['first', 'second', 'first', 'second']);

  const second = await h.restart();
  await expect(editor(second.page).locator('p')).toHaveCount(4);
  expect(await editor(second.page).locator('p').evaluateAll((ps) => ps.map((p) => p.getAttribute('data-id')))).toEqual(stored);
});

test('no script execution from pasted HTML (INF-EDIT-07)', async () => {
  const { app, page, id } = await openNew('Hostile');
  const hostile = [
    '<h2>Kept heading</h2><p>plain <b>kept bold</b></p>',
    '<script>window.__pwned = 1</script>',
    '<img src="http://example.invalid/x.png" onerror="window.__pwned = 2">',
    '<iframe src="https://evil.example/frame"></iframe>',
    '<object data="https://evil.example/o.swf"></object><embed src="https://evil.example/e.swf">',
    '<p><a href="javascript:window.__pwned = 3">js link</a></p>',
    '<style>body { display: none }</style>',
  ].join('');
  await seedClipboardHtml(app, hostile, 'Kept heading');
  await paste(page);
  await expect(editor(page).locator('h2')).toHaveText('Kept heading');
  await expect(editor(page).locator('strong')).toHaveText('kept bold');
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(page.locator('iframe, object, embed')).toHaveCount(0);
  await expect(editor(page).locator('script, style')).toHaveCount(0);
  await expect(editor(page).locator('img[src^="http"]')).toHaveCount(0);
  const imageLink = editor(page).locator('a[href="http://example.invalid/x.png"]');
  await expect(imageLink).toHaveText('Image: example.invalid');
  await expect(editor(page).locator('a[href^="javascript:"]')).toHaveCount(0);
  await waitSaved(page);
  await expect.poll(() => docOf(h, id).content?.length ?? 0).toBeGreaterThan(1);
  const json = h.one<{ content_json: string }>('SELECT content_json FROM notes WHERE id = ?', id)!.content_json;
  for (const bad of ['script', 'onerror', 'javascript:', 'iframe', 'evil.example']) expect(json).not.toContain(bad);
  expect((await blockedRequests(app)).filter((u) => u.includes('example.invalid') || u.includes('evil.example'))).toEqual([]);
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
});

test('bitmap from the real clipboard (INF-EDIT-08)', async () => {
  const { app, page, id } = await openNew('Bitmap');
  await seedClipboardImage(app, makePng(64, 48));
  await paste(page);
  await expect(firstImage(page)).toHaveAttribute('src', /^infinity-attachment:\/\//);
  await expect.poll(() => naturalWidth(page)).toBe(64);
  await waitSaved(page);
  await expect.poll(() => attachments().length).toBe(1);
  const [row] = attachments();
  expect(row).toMatchObject({ kind: 'image', mime: 'image/png' });
  const image = nodesOf(docOf(h, id)).find((n) => n.type === 'image')!;
  expect(image.attrs).toMatchObject({ attachmentId: row!.id, width: 64, height: 48 });
  expect(links(id)).toEqual([{ attachment_id: row!.id, block_id: image.attrs!.id }]);
  expect(fs.existsSync(managedFile(row!.managed_relative_path))).toBe(true);

  const second = await h.restart();
  await expect.poll(() => naturalWidth(second.page)).toBe(64);
});

test('the original image file may be removed (INF-EDIT-09)', async () => {
  const { app, page, id } = await openNew('Original');
  const original = path.join(h.userData, 'photo.png');
  fs.writeFileSync(original, makePng(50, 40));
  await queueDialog(app, [original]);
  await pressToolbar(page, 'Insert image');
  await expect.poll(() => naturalWidth(page)).toBe(50);
  await waitSaved(page);
  fs.rmSync(original);
  const [row] = attachments();
  expect(row!.original_name).toBe('photo.png');
  expect(managedFile(row!.managed_relative_path).startsWith(path.join(h.userData, 'data', 'attachments'))).toBe(true);
  expect(links(id)).toHaveLength(1);

  const second = await h.restart();
  await expect.poll(() => naturalWidth(second.page)).toBe(50);
});

test('drop an image file (SYNTHETIC DataTransfer) and a pasted data image (INF-EDIT-09)', async () => {
  const { app, page, id } = await openNew('Drops');
  await dropFiles(page, [{ name: 'dropped.png', type: 'image/png', base64: makePng(33, 22).toString('base64') }]);
  await expect.poll(() => naturalWidth(page)).toBe(33);
  await page.keyboard.press('Control+End');
  const dataUrl = `data:image/png;base64,${makePng(17, 11).toString('base64')}`;
  await seedClipboardHtml(app, `<p>with data image</p><img src="${dataUrl}" alt="inline">`, 'with data image');
  await paste(page);
  await expect(editor(page).locator('img')).toHaveCount(2);
  await expect.poll(() => editor(page).locator('img').nth(1).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(17);
  await waitSaved(page);
  await expect.poll(() => links(id).length).toBe(2);
  expect(attachments().map((a) => a.kind)).toEqual(['image', 'image']);
});

test('oversized and unsupported files show the exact messages (INF-EDIT-10)', async () => {
  const { app, page, id } = await openNew('Limits');
  const started = Date.now();
  await dropFiles(page, [{ name: 'huge.png', type: 'image/png', size: 21 * MB }]);
  await expect(toasts(page).filter({ hasText: 'This image is larger than 20 MB. Use a smaller image.' })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(2000 + 1000);
  expect(attachments()).toEqual([]);
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('still works');
  await waitSaved(page);
  await expect.poll(() => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', id)?.plain_text).toBe('still works');

  const big = path.join(h.userData, 'big.png');
  fs.writeFileSync(big, Buffer.concat([makePng(1, 1), Buffer.alloc(21 * MB)]));
  await queueDialog(app, [big]);
  await pressToolbar(page, 'Insert image');
  await expect(toasts(page).filter({ hasText: 'This image is larger than 20 MB. Use a smaller image.' })).toHaveCount(2);
  expect(attachments()).toEqual([]);

  await dropFiles(page, [{ name: 'drawing.svg', type: 'image/svg+xml', base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') }]);
  await expect(toasts(page).filter({ hasText: 'This image type is not supported. Use PNG, JPEG, GIF or WebP.' })).toBeVisible();
  await expect(editor(page).locator('img, .image-placeholder')).toHaveCount(0);
  expect(attachments()).toEqual([]);
});

test('document chip (INF-EDIT-14)', async () => {
  const { app, page, id } = await openNew('Docs');
  const pdf = path.join(h.userData, 'report.pdf');
  fs.writeFileSync(pdf, Buffer.from('%PDF-1.4\n% test document\n'.repeat(100)));
  const size = fs.statSync(pdf).size;
  await queueDialog(app, [pdf]);
  await chooseMore(page, 'Attach file');
  const chip = editor(page).locator('.file-chip');
  await expect(chip).toContainText('report.pdf');
  await expect(chip).toContainText(`${(size / 1024).toFixed(1)} KB`);
  await waitSaved(page);
  await expect.poll(() => links(id).length).toBe(1);
  const [row] = attachments();
  expect(row).toMatchObject({ kind: 'document', mime: 'application/pdf', original_name: 'report.pdf', size_bytes: size });
  fs.rmSync(pdf);

  const second = await h.restart();
  await expect(editor(second.page).locator('.file-chip')).toContainText('report.pdf');
  expect(fs.existsSync(managedFile(row!.managed_relative_path))).toBe(true);
});

const plainOf = (id: string) => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', id)!.plain_text;

test('a note over 5 MB says why it is not saved, keeps the saved text, and recovers with undo (QA-1)', async () => {
  const { app, page, id } = await openNew('Too large');
  await page.keyboard.insertText('KEEPME');
  await waitSaved(page);
  await seedClipboardHtml(app, `<p>${'lorem ipsum dolor sit amet consectetur '.repeat(160_000)}</p>`, 'x');
  await paste(page);
  await expect(saveStatus(page)).toHaveText('Not saved', { timeout: 60_000 });
  const alert = page.locator('.note-header [role="alert"]');
  await expect(alert).toHaveText('This note is too large to save (over 5 MB). Remove some content to keep editing safely.');
  await expect(saveStatus(page)).toHaveAttribute('title', 'This note is too large to save (over 5 MB). Remove some content to keep editing safely.');
  expect(plainOf(id)).toBe('KEEPME');
  await page.keyboard.press('Control+Z');
  await page.keyboard.insertText('!');
  await waitSaved(page);
  await expect(alert).toHaveCount(0);
  expect(plainOf(id)).toBe('KEEPME!');
});

test('large pastes are linear, save earlier typing first, and over 8 MB are refused (QA-2, D-060)', async () => {
  const { app, page, id } = await openNew('Big paste');
  // Typed inside the 400 ms debounce, right before a large paste: it is saved before the paste runs.
  await page.keyboard.insertText('KEEPME');
  await seedClipboardHtml(app, '<p>The quick brown fox jumps over the lazy dog 0123456789 lorem ipsum</p>'.repeat(12_000), 'x');
  const started = Date.now();
  await paste(page);
  // The first pasted paragraph joins the one holding KEEPME.
  await expect(editor(page).locator('p')).toHaveCount(12_000, { timeout: 30_000 });
  const elapsed = Date.now() - started;
  console.log(`large paste: 12,000 paragraphs in ${elapsed} ms`);
  expect(elapsed).toBeLessThan(15_000);
  await waitSaved(page);
  expect(plainOf(id).startsWith('KEEPME')).toBe(true);

  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' tail');
  await seedClipboardHtml(app, `<p>${'x'.repeat(9 * MB)}</p>`, 'x');
  await paste(page);
  await expect(toasts(page).filter({ hasText: 'This paste is too large (over 8 MB). Paste a smaller part.' })).toBeVisible();
  await expect(editor(page).locator('p')).toHaveCount(12_000);
  await waitSaved(page);
  expect(plainOf(id).endsWith(' tail')).toBe(true);
});

test('a paste nested deeper than a note can store is refused with a message (QA-3)', async () => {
  const { app, page, id } = await openNew('Deep');
  await page.keyboard.insertText('before');
  await waitSaved(page);
  const nested = (levels: number) => '<ul><li><p>l</p>'.repeat(levels) + '</li></ul>'.repeat(levels);
  await seedClipboardHtml(app, nested(40), 'l');
  await paste(page);
  await expect(toasts(page).filter({ hasText: 'This would nest lists or quotes more deeply than a note can store. Use fewer levels.' })).toBeVisible();
  await expect(editor(page).locator('li')).toHaveCount(0);
  await page.keyboard.insertText(' after');
  await waitSaved(page);
  expect(plainOf(id)).toBe('before after');
  // The deepest list that still saves is accepted (pasted into an empty paragraph).
  await page.keyboard.press('Enter');
  await seedClipboardHtml(app, nested(31), 'l');
  await paste(page);
  await expect(editor(page).locator('li')).toHaveCount(31);
  await waitSaved(page);
});
