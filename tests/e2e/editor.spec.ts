import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { makePng } from '../support/png';
import {
  blockedRequests,
  chooseMore,
  docOf,
  editor,
  editorSelectionText,
  editorText,
  findInput,
  focusEditorEnd,
  nodesOf,
  paletteAction,
  pressToolbar,
  queueDialog,
  saveStatus,
  seedClipboardHtml,
  seedClipboardImage,
  setHook,
  shellCalls,
  toolbar,
  toolbarButton,
  typeLines,
  waitSaved,
} from './editor-ui';
import { readMainLog, waitForExit } from './fixtures';
import { useApp } from './harness';
import { COMMON, createNote, importImage, reloadUi, saveDoc, saveText } from './seed';
import { activeTabLabel, dialogByName, openFromTree, tabItem, tabLabels, titleInput, toasts, treeByKey } from './ui';

const h = useApp();

interface NoteRow {
  id: string;
  revision: number;
  content_json: string | null;
  content_text: string | null;
  plain_text: string;
  title: string;
  format: string;
  deleted_at: number | null;
}
const noteRow = (id: string) =>
  h.one<NoteRow>('SELECT id, revision, content_json, content_text, plain_text, title, format, deleted_at FROM notes WHERE id = ?', id)!;
const storedTabs = () => {
  const row = h.one<{ value: string }>("SELECT value FROM settings WHERE key = 'session.tabs'");
  return row ? (JSON.parse(row.value) as { value: { tabs: Array<{ id: string; scrollTop?: number }> } }).value.tabs : [];
};

/** Writes a PNG into the test's userData folder (outside the managed attachments) and returns its path. */
function tempPng(name: string, width: number, height: number): string {
  const file = path.join(h.userData, name);
  fs.writeFileSync(file, makePng(width, height));
  return file;
}

test('flush on close', async () => {
  const { page } = await h.start();
  const d = await createNote(page, COMMON, 'Flush D');
  await reloadUi(page);
  await openFromTree(page, d);
  await expect(editor(page)).toBeVisible();
  const before = noteRow(d).revision;

  // Typing and closing inside the 400 ms debounce window must still persist the text.
  await focusEditorEnd(page);
  await page.keyboard.insertText('flush me');
  await page.keyboard.press('Control+W');
  await expect(tabItem(page, 'Flush D')).toHaveCount(0);
  await expect.poll(() => noteRow(d).revision).toBe(before + 1);
  expect(noteRow(d).content_json).toContain('flush me');
  expect(noteRow(d).plain_text).toContain('flush me');
  expect(noteRow(d).deleted_at).toBeNull();

  await h.restart();
  await openFromTree(h.page, d);
  await expect.poll(() => editorText(h.page)).toBe('flush me');
});

test('editor save increments revision and survives relaunch', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'Stable id note');
  await reloadUi(page);
  await openFromTree(page, id);
  await focusEditorEnd(page);
  await typeLines(page, 'first line\n\nthird line after an empty line\nপ্রথম লাইন');
  await waitSaved(page);
  await expect.poll(() => noteRow(id).revision).toBe(1);

  await typeLines(page, '\nmore');
  await expect.poll(() => noteRow(id).revision).toBe(2);
  expect(JSON.parse(noteRow(id).content_json!).type).toBe('doc');
  expect(noteRow(id).plain_text).toContain('more');

  // Renaming through the title field keeps the revision unchanged by rename and the id stable.
  const title = titleInput(page);
  await title.fill('Renamed by title field');
  await title.press('Enter');
  await expect.poll(() => noteRow(id).title).toBe('Renamed by title field');
  await expect(tabItem(page, 'Renamed by title field')).toBeVisible();
  await expect(editor(page)).toBeFocused();
  expect(noteRow(id).revision).toBe(2);

  const second = await h.restart();
  await expect.poll(() => tabLabels(second.page)).toEqual(['Home', 'Renamed by title field']);
  await expect.poll(() => activeTabLabel(second.page)).toBe('Renamed by title field');
  await expect.poll(() => editorText(second.page)).toBe('first line\n\nthird line after an empty line\nপ্রথম লাইন\nmore');
  expect(h.all('SELECT id FROM notes').map((r) => (r as { id: string }).id)).toEqual([id]);
});

test('single editor instance (INF-TABS-07)', async () => {
  const { page } = await h.start();
  const [one, two, three] = [await createNote(page, COMMON, 'One'), await createNote(page, COMMON, 'Two'), await createNote(page, COMMON, 'Three')];
  const image = await importImage(page, makePng(40, 30));
  await saveText(page, one, 'alpha text');
  await saveText(page, two, 'beta text');
  const lines = Array.from({ length: 80 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `line ${i + 1}` }] }));
  await saveDoc(page, three, { type: 'doc', content: [...lines, { type: 'image', attrs: { attachmentId: image.id, width: 40, height: 30 } }] });
  await reloadUi(page);
  for (const id of [one, two, three]) await openFromTree(page, id);

  const scroller = page.locator('.note-editor-scroll');
  await scroller.evaluate((el) => {
    el.scrollTop = 300;
  });
  await expect.poll(() => storedTabs().find((t) => t.id === `note:${three}`)?.scrollTop).toBe(300);

  const editorsIn = () => page.locator('#tabpanel .ProseMirror');
  const expectOneEditor = async () => {
    await expect(editorsIn()).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('data-live-editors', '1');
    for (const src of await page.locator('#tabpanel img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src') ?? ''))) {
      expect(src.startsWith('infinity-attachment://')).toBe(true);
    }
  };
  await expectOneEditor();
  await page.keyboard.press('Control+Tab');
  await expect.poll(() => activeTabLabel(page)).toBe('Home');
  await expect(editorsIn()).toHaveCount(0);
  await expect(page.locator('#tabpanel img')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-live-editors', '0');
  for (const [label, text] of [
    ['One', 'alpha text'],
    ['Two', 'beta text'],
  ] as const) {
    await page.keyboard.press('Control+Tab');
    await expect.poll(() => activeTabLabel(page)).toBe(label);
    await expectOneEditor();
    await expect.poll(() => editorText(page)).toBe(text);
  }
  await page.keyboard.press('Control+Tab');
  await expect.poll(() => activeTabLabel(page)).toBe('Three');
  await expectOneEditor();
  await expect(page.locator('#tabpanel img')).toHaveCount(1);
  await expect.poll(() => page.locator('#tabpanel img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(40);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(300);
  expect((await editorText(page)).startsWith('line 1\nline 2')).toBe(true);
});

test('find in note (INF-KEY-04)', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'Find me');
  await saveText(page, id, 'alpha beta Alpha ALPHA বাংলা');
  await reloadUi(page);
  await openFromTree(page, id);
  const revision = noteRow(id).revision;
  await focusEditorEnd(page);
  await page.keyboard.press('Control+F');
  await expect(findInput(page)).toBeFocused();
  const count = page.locator('.find-count');
  await findInput(page).fill('alpha');
  await expect(count).toHaveText('1 of 3');
  await expect(page.locator('.ProseMirror .find-match')).toHaveCount(3);
  await page.keyboard.press('Enter');
  await expect(count).toHaveText('2 of 3');
  await page.keyboard.press('Shift+Enter');
  await expect(count).toHaveText('1 of 3');
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Enter');
  await expect(count).toHaveText('1 of 3');
  await findInput(page).fill('বাংলা');
  await expect(count).toHaveText('1 of 1');
  await findInput(page).fill('zzz');
  await expect(count).toHaveText('No results');
  await findInput(page).fill('beta');
  await expect(count).toHaveText('1 of 1');
  await page.keyboard.press('Escape');
  await expect(findInput(page)).toHaveCount(0);
  await expect(page.locator('.ProseMirror .find-match')).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('beta');
  expect(noteRow(id).revision).toBe(revision);

  await page.keyboard.press('Control+Tab');
  await expect.poll(() => activeTabLabel(page)).toBe('Home');
  await page.keyboard.press('Control+F');
  await expect(findInput(page)).toHaveCount(0);
});

test('formatting survives reload (INF-EDIT-02)', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'Formats');
  await reloadUi(page);
  await openFromTree(page, id);
  await focusEditorEnd(page);
  const k = page.keyboard;
  await k.press('Control+Alt+1');
  await k.insertText('Plan');
  await k.press('Enter');
  await k.press('Control+B');
  await k.insertText('bold');
  await k.press('Control+B');
  await k.insertText(' ');
  await k.press('Control+I');
  await k.insertText('italic');
  await k.press('Control+I');
  await k.insertText(' ');
  await k.press('Control+E');
  await k.insertText('code');
  await k.press('Control+E');
  await k.press('Enter');
  await k.insertText('docs');
  for (let i = 0; i < 4; i += 1) await k.press('Shift+ArrowLeft');
  await expect.poll(() => editorSelectionText(page)).toBe('docs');
  await pressToolbar(page, 'Link');
  const linkDialog = dialogByName(page, 'Link');
  await linkDialog.getByLabel('Address').fill('https://example.com/docs');
  await linkDialog.getByLabel('Address').press('Enter');
  await expect(linkDialog).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  // ArrowRight collapses the selection to its end on every platform (End does not on Linux with a selection).
  await k.press('ArrowRight');
  await expect.poll(() => editorSelectionText(page)).toBe('');
  await k.press('Enter');
  await k.press('Control+Shift+8');
  await k.insertText('bullet');
  await k.press('Enter');
  await k.press('Enter');
  await k.press('Control+Shift+7');
  await k.insertText('numbered');
  await k.press('Enter');
  await k.press('Enter');
  await k.press('Control+Shift+9');
  await k.insertText('task');
  await k.press('Control+Enter');
  await k.press('Enter');
  await k.press('Enter');
  await pressToolbar(page, 'Code block');
  await expect(editor(page)).toBeFocused();
  await expect(editor(page).locator('pre')).toHaveCount(1);
  await k.insertText('let x = 1;');
  await waitSaved(page);

  const doc = docOf(h, id);
  const nodes = nodesOf(doc);
  const types = new Set(nodes.map((n) => n.type));
  for (const t of ['heading', 'bulletList', 'orderedList', 'taskList', 'taskItem', 'codeBlock']) expect(types, t).toContain(t);
  expect(nodes.find((n) => n.type === 'heading')?.attrs?.level).toBe(1);
  const marks = nodes.flatMap((n) => (n.marks ?? []).map((m) => ({ ...m, text: n.text })));
  expect(marks).toEqual(
    expect.arrayContaining([
      { type: 'bold', text: 'bold' },
      { type: 'italic', text: 'italic' },
      { type: 'code', text: 'code' },
      { type: 'link', attrs: { href: 'https://example.com/docs' }, text: 'docs' },
    ]),
  );
  expect(nodes.find((n) => n.type === 'taskItem')?.attrs?.checked).toBe(true);
  expect(nodes.find((n) => n.type === 'codeBlock')?.content?.[0]?.text).toBe('let x = 1;');

  const second = await h.restart();
  const p = second.page;
  await expect(editor(p).locator('h1')).toHaveText('Plan');
  await expect(editor(p).locator('strong')).toHaveText('bold');
  await expect(editor(p).locator('em')).toHaveText('italic');
  await expect(editor(p).locator('p code')).toHaveText('code');
  await expect(editor(p).locator('a[href="https://example.com/docs"]')).toHaveText('docs');
  await expect(editor(p).locator('ul:not([data-type]) li')).toHaveText('bullet');
  await expect(editor(p).locator('ol li')).toHaveText('numbered');
  await expect(editor(p).locator('li[data-checked="true"] p')).toHaveText('task');
  await expect(editor(p).locator('pre code')).toHaveText('let x = 1;');
});

test('undo and redo (INF-EDIT-02)', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'History');
  await reloadUi(page);
  await openFromTree(page, id);
  await focusEditorEnd(page);
  await page.keyboard.insertText('abc');
  await expect.poll(() => editorText(page)).toBe('abc');
  await page.keyboard.press('Control+Z');
  await expect.poll(() => editorText(page)).toBe('');
  await page.keyboard.press('Control+Y');
  await expect.poll(() => editorText(page)).toBe('abc');
  await waitSaved(page);
  await expect.poll(() => noteRow(id).plain_text).toBe('abc');
});

test('rename flushes (INF-EDIT-03)', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'Before');
  await reloadUi(page);
  await openFromTree(page, id);
  const revision = noteRow(id).revision;
  await titleInput(page).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Renamed note');
  await page.keyboard.press('Control+W');
  await expect(tabItem(page, 'Renamed note')).toHaveCount(0);
  await expect.poll(() => noteRow(id).title).toBe('Renamed note');
  await expect(treeByKey(page, `note:${id}`)).toContainText('Renamed note');

  await openFromTree(page, id);
  await titleInput(page).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await expect(titleInput(page)).toHaveAttribute('placeholder', 'Untitled');
  await editor(page).click();
  await expect.poll(() => noteRow(id).title).toBe('');
  await expect(tabItem(page, 'Untitled')).toBeVisible();
  await expect(treeByKey(page, `note:${id}`)).toContainText('Untitled');
  expect(noteRow(id).revision).toBe(revision);
});

test('plain note (INF-EDIT-04)', async () => {
  const { app, page } = await h.start();
  await paletteAction(page, 'New plain-text note');
  await expect(titleInput(page)).toBeFocused();
  const id = h.one<{ id: string }>('SELECT id FROM notes ORDER BY created_at DESC LIMIT 1')!.id;
  expect(noteRow(id)).toMatchObject({ format: 'plain', content_text: '', content_json: null });
  await expect(toolbarButton(page, 'Bold')).toHaveCount(0);
  await expect(toolbarButton(page, 'Find in note')).toBeVisible();
  await expect(toolbarButton(page, 'Convert to rich text')).toBeVisible();
  await expect(toolbarButton(page, 'Version history')).toBeVisible();

  await focusEditorEnd(page);
  await page.keyboard.press('Control+B');
  await page.keyboard.insertText('first line');
  await expect(editor(page).locator('strong')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await seedClipboardHtml(app, '<h1>Big</h1><p><b>bold</b> words</p>', 'Big\nbold words');
  await page.keyboard.press('Control+V');
  await expect.poll(() => editorText(page)).toBe('first line\nBig\nbold words');
  await expect(editor(page).locator('h1, strong, b')).toHaveCount(0);

  await seedClipboardImage(app, makePng(8, 8));
  await page.keyboard.press('Control+V');
  await expect(toasts(page).filter({ hasText: 'Plain-text notes cannot contain images. Convert to rich text to add images.' })).toBeVisible();
  await expect(editor(page).locator('img')).toHaveCount(0);
  await waitSaved(page);
  await expect.poll(() => noteRow(id).content_text).toBe('first line\nBig\nbold words');
  expect(noteRow(id)).toMatchObject({ format: 'plain', content_json: null, plain_text: 'first line\nBig\nbold words' });

  const second = await h.restart();
  await expect.poll(() => editorText(second.page)).toBe('first line\nBig\nbold words');
  await expect(toolbarButton(second.page, 'Bold')).toHaveCount(0);
});

test('conversion warning and version history (INF-EDIT-05, INF-SAVE-06)', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'Convert me');
  const image = await importImage(page, makePng(30, 20));
  await saveDoc(page, id, {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Plan' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'body text' }] },
      { type: 'image', attrs: { attachmentId: image.id, width: 30, height: 20, alt: 'chart' } },
    ],
  });
  await reloadUi(page);
  await openFromTree(page, id);
  await expect(editor(page).locator('h1')).toHaveText('Plan');

  await chooseMore(page, 'Convert to plain text…');
  const dialog = dialogByName(page, 'Convert to plain text?');
  await expect(dialog.getByRole('heading')).toHaveText('Convert to plain text?');
  await expect(dialog.locator('.dialog-body')).toHaveText('Formatting, checklists, links and images will be removed. A version of the current note is saved so you can restore it.');
  await dialog.getByRole('button', { name: 'Cancel' }).press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(toolbarButton(page, 'Bold')).toBeVisible();
  expect(noteRow(id).format).toBe('rich');

  await chooseMore(page, 'Convert to plain text…');
  const convert = dialogByName(page, 'Convert to plain text?').getByRole('button', { name: 'Convert' });
  await convert.focus();
  await convert.press('Enter');
  await expect(page.getByText('Converted to plain text. A version with formatting and images was saved.')).toBeVisible();
  await expect(toolbarButton(page, 'Bold')).toHaveCount(0);
  await expect.poll(() => noteRow(id).format).toBe('plain');
  expect(noteRow(id).content_text).toBe('Plan\nbody text');
  await expect.poll(() => editorText(page)).toBe('Plan\nbody text');

  // The version is listed in Version history; restore it from the banner.
  await pressToolbar(page, 'Version history');
  const history = dialogByName(page, 'Version history');
  await expect(history.locator('.version-row')).toHaveCount(1);
  await expect(history.locator('.version-row')).toContainText('Before conversion');
  await expect(history.locator('.version-row')).toContainText('Rich text');
  await history.getByRole('button', { name: 'Close' }).press('Enter');

  const restore = page.getByRole('button', { name: 'Restore formatted version' });
  await restore.focus();
  await restore.press('Enter');
  await expect(editor(page).locator('h1')).toHaveText('Plan');
  await expect.poll(() => editor(page).locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => noteRow(id).format).toBe('rich');

  // Version history now also lists the plain text saved before the restore; restoring it asks first.
  await chooseMore(page, 'Version history…');
  const again = dialogByName(page, 'Version history');
  const restoreRow = again.locator('.version-row').filter({ hasText: 'Before restoring a version' });
  await expect(restoreRow).toContainText('Plain text');
  await restoreRow.getByRole('button', { name: 'Restore' }).press('Enter');
  const confirm = dialogByName(page, 'Restore this version?');
  await expect(confirm).toContainText('The current content is saved as a version first.');
  await confirm.getByRole('button', { name: 'Restore' }).press('Enter');
  await expect.poll(() => noteRow(id).format).toBe('plain');
  await expect.poll(() => editorText(page)).toBe('Plan\nbody text');
  // And back to the formatted version for the restart check (plain notes have Version history on the toolbar).
  await pressToolbar(page, 'Version history');
  await dialogByName(page, 'Version history').locator('.version-row').filter({ hasText: 'Rich text' }).first().getByRole('button', { name: 'Restore' }).press('Enter');
  await dialogByName(page, 'Restore this version?').getByRole('button', { name: 'Restore' }).press('Enter');
  await expect.poll(() => noteRow(id).format).toBe('rich');

  const second = await h.restart();
  await expect(editor(second.page).locator('h1')).toHaveText('Plan');
  await expect.poll(() => editor(second.page).locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
});

test('image size preset (INF-EDIT-11)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Sizes');
  await reloadUi(page);
  await openFromTree(page, id);
  await focusEditorEnd(page);
  await queueDialog(app, [tempPng('wide.png', 800, 200)]);
  await pressToolbar(page, 'Insert image');
  const img = editor(page).locator('img');
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(800);
  const width = () => img.evaluate((i) => Math.round(i.getBoundingClientRect().width));
  await expect.poll(width).toBe(480);
  await img.click();
  const sizes = toolbar(page).getByRole('radiogroup', { name: 'Image size' });
  await sizes.getByRole('radio', { name: 'Small' }).check();
  await expect.poll(width).toBe(240);
  await sizes.getByRole('radio', { name: 'Full width' }).check();
  const contentWidth = await editor(page).evaluate((el) => el.clientWidth);
  await expect.poll(width).toBeGreaterThan(480);
  expect(await width()).toBeLessThanOrEqual(contentWidth);
  await waitSaved(page);
  await expect.poll(() => nodesOf(docOf(h, id)).find((n) => n.type === 'image')?.attrs?.size).toBe('full');

  const second = await h.restart();
  const again = editor(second.page).locator('img');
  await expect.poll(() => again.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(800);
  await expect.poll(() => again.evaluate((i) => Math.round(i.getBoundingClientRect().width))).toBeGreaterThan(480);
});

test('Bangla title and text are stored exactly (INF-EDIT-12)', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'Temp');
  await reloadUi(page);
  await openFromTree(page, id);
  await titleInput(page).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('বাংলা নোট');
  await focusEditorEnd(page);
  const body = 'আমার সোনার বাংলা é 😀';
  await page.keyboard.insertText(body);
  await waitSaved(page);
  await expect.poll(() => noteRow(id).title).toBe('বাংলা নোট');
  await expect.poll(() => noteRow(id).plain_text).toBe(body);
  expect(Buffer.from(noteRow(id).plain_text).equals(Buffer.from(body))).toBe(true);

  const second = await h.restart();
  await expect.poll(() => editorText(second.page)).toBe(body);
  await expect(titleInput(second.page)).toHaveValue('বাংলা নোট');
});

test('save indicator (INF-EDIT-13)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Status');
  await reloadUi(page);
  await openFromTree(page, id);
  await focusEditorEnd(page);
  await page.keyboard.insertText('a');
  await expect(saveStatus(page)).toHaveText('Editing…');
  await expect(saveStatus(page)).toHaveText('Saved');

  await setHook(app, 'failSaves', 4);
  await page.keyboard.insertText('b');
  await expect(saveStatus(page)).toHaveText('Not saved - retrying');
  await expect(saveStatus(page)).toHaveText('Not saved', { timeout: 15_000 });
  await setHook(app, 'failSaves', 0);
  await page.keyboard.insertText('c');
  await expect(saveStatus(page)).toHaveText('Saved');
  await expect.poll(() => noteRow(id).plain_text).toBe('abc');

  await setHook(app, 'importDelayMs', 1500);
  await seedClipboardImage(app, makePng(12, 9));
  await page.keyboard.press('Control+V');
  await expect(editor(page).getByText('Adding image…')).toBeVisible();
  await expect.poll(() => editor(page).locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 15_000 }).toBe(12);
  await expect(editor(page).getByText('Adding image…')).toHaveCount(0);
});

test('flush on tab switch (INF-SAVE-01)', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'Switch');
  await reloadUi(page);
  await openFromTree(page, id);
  await focusEditorEnd(page);
  await page.keyboard.insertText('saved by switching');
  await page.keyboard.press('Control+Tab');
  await expect.poll(() => activeTabLabel(page)).toBe('Home');
  await expect.poll(() => noteRow(id).plain_text).toBe('saved by switching');
});

for (const how of ['window close', 'quit'] as const) {
  test(`flush on ${how} (INF-SAVE-01)`, async () => {
    const { app, page } = await h.start();
    const id = await createNote(page, COMMON, `Flush ${how}`);
    await reloadUi(page);
    await openFromTree(page, id);
    await focusEditorEnd(page);
    await page.keyboard.insertText(`kept on ${how}`);
    const proc = app.process();
    if (how === 'quit') {
      await app.evaluate(({ app: electronApp }) => {
    // On a fresh task, as closeApp does (F04-A2): never inside a statement an inspector interrupt paused.
    setImmediate(() => electronApp.quit());
  });
    } else {
      // Closing the main window asks first (D-066); the answer "Quit" quits, which flushes every window.
      const asked = await app.evaluate(({ BrowserWindow }) => {
        const hooks = globalThis.__infinityTest!;
        hooks.closeChoices.push({ choice: 'quit', remember: false });
        BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.close();
        return hooks.closeDialogs.map((d) => d.message);
      });
      expect(asked).toEqual(['Keep Infinity Notes running in the background?']);
    }
    expect(await waitForExit(proc, 15_000)).toBe(true);
    expect(readMainLog(h.userData)).toContain('flush: requested=1 acked=1 timedOut=0');
    expect(noteRow(id).plain_text).toBe(`kept on ${how}`);
    if (how === 'window close') expect(h.setting('app.closeBehavior')).toBeUndefined();
    const second = await h.restart();
    await expect.poll(() => editorText(second.page)).toBe(`kept on ${how}`);
  });
}

test('link open (INF-SEC-01)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Links');
  await saveDoc(page, id, {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see ' }, { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://example.com/docs' } }] }] }],
  });
  await reloadUi(page);
  await openFromTree(page, id);
  const link = editor(page).locator('a[href="https://example.com/docs"]');
  await link.click();
  await expect(page.getByRole('group', { name: 'Link' })).toContainText('https://example.com/docs');
  expect(await shellCalls(app)).toEqual([]);
  await link.click({ modifiers: ['Control'] });
  await expect.poll(() => shellCalls(app)).toEqual([{ op: 'openExternal', url: 'https://example.com/docs' }]);
  await page.getByRole('group', { name: 'Link' }).getByRole('button', { name: 'Open link' }).press('Enter');
  await expect.poll(() => shellCalls(app)).toHaveLength(2);
  expect((await shellCalls(app))[1]).toEqual({ op: 'openExternal', url: 'https://example.com/docs' });

  await page.getByRole('group', { name: 'Link' }).getByRole('button', { name: 'Edit link' }).press('Enter');
  const dialog = dialogByName(page, 'Link');
  await dialog.getByLabel('Address').fill('javascript:alert(1)');
  await dialog.getByLabel('Address').press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('Use an address that starts with http:// or https://');
  await dialog.getByRole('button', { name: 'Cancel' }).press('Enter');
  await expect(dialog).toHaveCount(0);
  expect(docOf(h, id).content![0]!.content![1]!.marks).toEqual([{ type: 'link', attrs: { href: 'https://example.com/docs' } }]);
  expect(await blockedRequests(app)).toEqual([]);
});
