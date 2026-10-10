import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { paletteAction, queueDialog, selectionChange } from './editor-ui';
import { useApp } from './harness';
import { activate, dialogByName, tabItem } from './ui';

/**
 * The Word viewer and editor (F4, D-142..D-148). Written in Run 3; run in WSL under Xvfb and on CI at the end of
 * release 0.3.0. The page is @portone/docx-editor's contenteditable sheet; its toolbar is the editor's own, the row
 * above it (Page break, Find, Save) is the app's.
 */
const h = useApp({ failOnMainErrors: true });
const FIXTURES = path.resolve('tests/fixtures/documents');

let dir = '';
test.beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-docx-')));
});
test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function importFile(page: Page, app: ElectronApplication, file: string, action: 'Copy into Infinity Notes' | 'Link to the original' = 'Copy into Infinity Notes') {
  await queueDialog(app, [file]);
  await paletteAction(page, 'Import file…');
  const dialog = dialogByName(page, 'Add file');
  await activate(dialog.getByRole('button', { name: action }));
  await expect(dialog).toHaveCount(0);
}

function copyFixture(sample: string, name: string): string {
  const file = path.join(dir, name);
  fs.copyFileSync(path.join(FIXTURES, sample), file);
  return file;
}

function storedFile(title: string): string {
  const row = h.one<{ relative_path: string }>('SELECT b.relative_path FROM documents d JOIN document_blobs b ON b.id = d.blob_id WHERE d.title = ? AND d.deleted_at IS NULL', title)!;
  return path.join(h.userData, 'data', row.relative_path);
}
const revisionOf = (title: string) => h.one<{ revision: number }>('SELECT revision FROM documents WHERE title = ? AND deleted_at IS NULL', title)?.revision;
const bodyXml = (title: string) => strFromU8(unzipSync(new Uint8Array(fs.readFileSync(storedFile(title))))['word/document.xml']!);

const appToolbar = (page: Page) => page.getByRole('toolbar', { name: 'Word document' });
const status = (page: Page) => appToolbar(page).getByRole('status');
const editorToolbar = (page: Page) => page.getByRole('toolbar', { name: 'Editor toolbar' });
const sheet = (page: Page) => page.locator('.docx-viewer .docx-editor-sheet');

async function openWord(page: Page, app: ElectronApplication, sample = 'sample-rich.docx', name = 'Handbook.docx'): Promise<string> {
  await importFile(page, app, copyFixture(sample, name));
  const title = path.basename(name, path.extname(name));
  await expect(tabItem(page, title)).toHaveAttribute('aria-selected', 'true');
  await expect(sheet(page)).toContainText('Project handbook');
  return title;
}

/** Puts the caret at the end of the paragraph holding `text`. */
async function caretAfter(page: Page, text: string) {
  await sheet(page).getByText(text, { exact: true }).click();
  await page.keyboard.press('End');
}

async function saveAndWait(page: Page, title: string, revision: number) {
  await expect(status(page)).toHaveText('Unsaved changes');
  await page.keyboard.press('Control+S');
  await expect.poll(() => revisionOf(title)).toBe(revision);
  await expect(status(page)).toHaveText('');
}

test('opens a Word document in page layout with its header, picture, table and comment', async () => {
  const { app, page } = await h.start();
  await openWord(page, app);
  await expect(sheet(page).locator('img.docx-editor-img')).toHaveCount(1);
  await expect(sheet(page).locator('table')).toHaveCount(1);
  await expect(page.locator('.docx-viewer')).toContainText('Handbook header');
  await expect(page.locator('.docx-editor-comments')).toContainText('Check this sentence');
  // The picture is drawn: the CSP allows data: images (D-148) and nothing was blocked.
  expect(await sheet(page).locator('img.docx-editor-img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);
});

test('edits and formats text, saves with Ctrl+S, and reopening shows the edit', async () => {
  const { app, page } = await h.start();
  const title = await openWord(page, app);
  await caretAfter(page, 'Last paragraph of the handbook.');
  await page.keyboard.type(' Added in the app.');
  await selectionChange(page, () => page.keyboard.press('Shift+Home'));
  await activate(editorToolbar(page).getByRole('button', { name: 'Bold' }));
  await saveAndWait(page, title, 1);
  expect(bodyXml(title)).toContain('Added in the app.');
  expect(bodyXml(title)).toMatch(/<w:b\/>/);
  // Untouched parts keep their bytes (D-142).
  const before = unzipSync(new Uint8Array(fs.readFileSync(path.join(FIXTURES, 'sample-rich.docx'))));
  const after = unzipSync(new Uint8Array(fs.readFileSync(storedFile(title))));
  expect(Buffer.from(after['word/header1.xml']!).equals(Buffer.from(before['word/header1.xml']!))).toBe(true);
  expect(Buffer.from(after['word/media/image1.png']!).equals(Buffer.from(before['word/media/image1.png']!))).toBe(true);

  await activate(page.getByRole('tab', { name: 'Home', exact: true }));
  await page.getByRole('tab', { name: title }).click();
  await expect(sheet(page)).toContainText('Added in the app.');
});

test('headings, lists, alignment, a table and a page break from the toolbars', async () => {
  const { app, page } = await h.start();
  const title = await openWord(page, app);
  await caretAfter(page, 'Last paragraph of the handbook.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Numbered item');
  await activate(editorToolbar(page).getByRole('button', { name: 'Numbered list' }));
  await activate(editorToolbar(page).getByRole('button', { name: 'Alignment', exact: true }));
  await activate(page.getByRole('menuitemradio', { name: 'Align center' }));
  await activate(appToolbar(page).getByRole('button', { name: 'Page break' }));
  await saveAndWait(page, title, 1);
  const xml = bodyXml(title);
  expect(xml).toContain('Numbered item');
  expect(xml).toMatch(/<w:numPr>/);
  expect(xml).toMatch(/<w:jc w:val="center"\/>/);
  expect(xml.match(/<w:br w:type="page"\/>/g)?.length).toBe(2);
});

test('closing the tab saves edits first', async () => {
  const { app, page } = await h.start();
  const title = await openWord(page, app);
  await caretAfter(page, 'Appendix');
  await page.keyboard.type(' A');
  await expect(status(page)).toHaveText('Unsaved changes');
  await page.keyboard.press('Control+W');
  await expect.poll(() => revisionOf(title)).toBe(1);
  expect(bodyXml(title)).toContain('Appendix A');
});

test('find highlights matches and steps through them (Ctrl+F)', async () => {
  const { app, page } = await h.start();
  await openWord(page, app);
  await sheet(page).click();
  await page.keyboard.press('Control+F');
  const find = page.getByRole('searchbox', { name: 'Find in document' });
  await expect(find).toBeFocused();
  await find.fill('handbook');
  await expect(page.locator('.document-find-count')).toHaveText('1 of 3');
  await expect(sheet(page).locator('.docx-find-match')).toHaveCount(3);
  await find.press('Enter');
  await expect(page.locator('.document-find-count')).toHaveText('2 of 3');
  await find.press('Escape');
  await expect(sheet(page).locator('.docx-find-match')).toHaveCount(0);
});

test('Versions: an earlier version opens read-only and restores', async () => {
  const { app, page } = await h.start();
  const title = await openWord(page, app);
  const original = fs.readFileSync(storedFile(title));
  await caretAfter(page, 'Appendix');
  await page.keyboard.type(' two');
  await saveAndWait(page, title, 1);
  await activate(page.getByRole('button', { name: 'Versions' }));
  const panel = page.getByRole('complementary', { name: 'Versions' });
  await expect(panel.locator('.version-row')).toHaveCount(1);
  await activate(panel.getByRole('button', { name: 'Open' }));
  await expect(page.locator('.document-version-banner')).toContainText('Revision 0 from');
  await expect(status(page)).toHaveText('Read-only');
  await expect(editorToolbar(page)).toHaveCount(0);
  await expect(sheet(page)).not.toContainText('Appendix two');
  await activate(page.locator('.document-version-banner').getByRole('button', { name: 'Restore this version' }));
  await expect.poll(() => revisionOf(title)).toBe(2);
  expect(fs.readFileSync(storedFile(title))).toEqual(original);
  await expect(sheet(page)).not.toContainText('Appendix two');
});

test('search finds text saved in a Word document and opens it', async () => {
  const { app, page } = await h.start();
  const title = await openWord(page, app);
  await caretAfter(page, 'Appendix');
  await page.keyboard.type(' Quokka');
  await saveAndWait(page, title, 1);
  await activate(page.getByRole('tab', { name: 'Home', exact: true }));
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox', { name: 'Type a command or search notes' }).fill('quokka');
  await expect(page.getByRole('option', { name: /Handbook/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(tabItem(page, title)).toHaveAttribute('aria-selected', 'true');
  await expect(sheet(page)).toContainText('Appendix Quokka');
});
