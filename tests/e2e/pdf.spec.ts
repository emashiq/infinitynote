import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { extractPdfText } from '../../src/main/documents/text/pdf-text';
import { paletteAction, queueDialog } from './editor-ui';
import { useApp } from './harness';
import { activate, dialogByName, menuItem, tabItem } from './ui';

/** The PDF viewer and editor (F2, D-128..D-133). Written in Run 1; run in WSL under Xvfb and on CI at the end of release 0.3.0. */
const h = useApp({ failOnMainErrors: true });
const FIXTURES = path.resolve('tests/fixtures/documents');

let dir = '';
test.beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-pdf-')));
});
test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function original(sample: string, name: string): string {
  const file = path.join(dir, name);
  fs.copyFileSync(path.join(FIXTURES, sample), file);
  return file;
}

async function importPdf(page: Page, app: Parameters<typeof queueDialog>[0], sample: string, name: string) {
  await queueDialog(app, [original(sample, name)]);
  await paletteAction(page, 'Import file…');
  const dialog = dialogByName(page, 'Add file');
  await activate(dialog.getByRole('button', { name: 'Copy into Infinity Notes' }));
  await expect(dialog).toHaveCount(0);
}

/** The stored bytes of a managed document's current revision. */
function storedBytes(title: string): Uint8Array {
  const row = h.one<{ relative_path: string }>('SELECT b.relative_path FROM documents d JOIN document_blobs b ON b.id = d.blob_id WHERE d.title = ? AND d.deleted_at IS NULL', title)!;
  return new Uint8Array(fs.readFileSync(path.join(h.userData, 'data', row.relative_path)));
}
const revisionOf = (title: string) => h.one<{ revision: number }>('SELECT revision FROM documents WHERE title = ?', title)?.revision;
const pagesText = async (bytes: Uint8Array) => (await extractPdfText(bytes.slice(), { maxPages: 100, maxChars: 100_000 })).split('\n\n');

const viewer = (page: Page) => page.locator('.pdf-viewer');
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'PDF' });
const thumbnails = (page: Page) => page.getByRole('listbox', { name: 'Pages' });
const thumbnail = (page: Page, n: number, of: number) => thumbnails(page).getByRole('option', { name: `Page ${n} of ${of}` });

async function pagesMenu(page: Page, item: string) {
  await activate(toolbar(page).getByRole('button', { name: 'Pages', exact: true }));
  await activate(menuItem(page, item));
}

async function save(page: Page, title: string, revision: number) {
  await expect(toolbar(page).getByRole('status')).toHaveText('Unsaved changes');
  await page.keyboard.press('Control+S');
  await expect.poll(() => revisionOf(title)).toBe(revision);
  await expect(toolbar(page).getByRole('status')).toHaveText('');
}

test('opens a PDF with its pages, thumbnails and outline, and finds text with highlights', async () => {
  const { app, page } = await h.start();
  await importPdf(page, app, 'sample-pages.pdf', 'Plan.pdf');
  await expect(tabItem(page, 'Plan')).toHaveAttribute('aria-selected', 'true');
  await expect(viewer(page).locator('.textLayer').first()).toContainText('Alpha page introduces the plan');
  await expect(toolbar(page).getByRole('textbox', { name: 'Page number' })).toHaveValue('1');
  await expect(thumbnails(page).getByRole('option')).toHaveCount(3);

  await page.keyboard.press('Control+F');
  const find = page.getByRole('searchbox', { name: 'Find in PDF' });
  await expect(find).toBeFocused();
  await find.fill('details');
  await expect(page.locator('.document-find-count')).toHaveText('1 of 1');
  await expect(viewer(page).locator('.textLayer .highlight').first()).toBeVisible();
  await expect(toolbar(page).getByRole('textbox', { name: 'Page number' })).toHaveValue('2');
  await find.press('Escape');
  await expect(find).toHaveCount(0);

  await activate(page.getByRole('radio', { name: 'Outline' }));
  await activate(page.getByRole('button', { name: 'Summary' }));
  await expect(toolbar(page).getByRole('textbox', { name: 'Page number' })).toHaveValue('3');
  // Zoom and view rotation do not change the file.
  await toolbar(page).getByRole('combobox', { name: 'Zoom' }).selectOption('page-fit');
  await activate(toolbar(page).getByRole('button', { name: 'Rotate view' }));
  await expect(toolbar(page).getByRole('status')).toHaveText('');
  expect(revisionOf('Plan')).toBe(0);
});

test('an annotation is saved into the PDF with Ctrl+S and shows again after the tab is reopened', async () => {
  const { app, page } = await h.start();
  await importPdf(page, app, 'sample.pdf', 'Notes.pdf');
  await expect(viewer(page).locator('.textLayer').first()).toContainText('Infinity Notes sample PDF');
  await activate(toolbar(page).getByRole('button', { name: 'Add text' }));
  const firstPage = viewer(page).locator('.page').first();
  await firstPage.click({ position: { x: 150, y: 250 } });
  await page.keyboard.type('Reviewed in E2E');
  await page.keyboard.press('Escape');
  await save(page, 'Notes', 1);
  const saved = Buffer.from(storedBytes('Notes')).toString('latin1');
  expect(saved).toMatch(/\/FreeText/);
  expect(saved).toContain('Reviewed in E2E');
  expect(h.all('SELECT revision FROM document_versions')).toHaveLength(1);

  await page.keyboard.press('Control+W');
  await expect(tabItem(page, 'Notes')).toHaveCount(0);
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox', { name: 'Type a command or search notes' }).fill('Notes');
  await page.getByRole('option', { name: /Notes/ }).first().click();
  await expect(viewer(page).locator('.textLayer').first()).toContainText('Infinity Notes sample PDF');
  // The saved annotation is part of the file now: the text tool shows it as an editable text box again.
  await activate(toolbar(page).getByRole('button', { name: 'Add text' }));
  await expect(viewer(page).locator('.freeTextEditor').first()).toContainText('Reviewed in E2E');
});

test('delete and reorder pages, then save: the stored file has the new pages in the new order', async () => {
  const { app, page } = await h.start();
  await importPdf(page, app, 'sample-pages.pdf', 'Plan.pdf');
  await expect(thumbnails(page).getByRole('option')).toHaveCount(3);
  await activate(thumbnail(page, 2, 3));
  await pagesMenu(page, 'Delete page');
  await expect(thumbnails(page).getByRole('option')).toHaveCount(2);
  // Keyboard reorder: the first page moves down one place.
  await thumbnail(page, 1, 2).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Alt+ArrowDown');
  await save(page, 'Plan', 1);
  const bytes = storedBytes('Plan');
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  expect(await pagesText(bytes)).toEqual(['Charlie page closes the summary', 'Alpha page introduces the plan']);
});

test('extract pages to a new PDF next to the original, and insert the pages of another PDF', async () => {
  const { app, page } = await h.start();
  await importPdf(page, app, 'sample-pages.pdf', 'Plan.pdf');
  // Pointer selection: a click selects page 1 (Enter would only show it), Shift+click extends to page 3.
  await thumbnail(page, 1, 3).click();
  await thumbnail(page, 3, 3).click({ modifiers: ['Shift'] });
  await pagesMenu(page, 'Extract pages to a new PDF');
  await expect.poll(() => h.all<{ title: string }>("SELECT title FROM documents WHERE kind = 'pdf' ORDER BY created_at").map((r) => r.title)).toEqual(['Plan', 'Plan (pages 1-3)']);
  expect(await pagesText(storedBytes('Plan (pages 1-3)'))).toHaveLength(3);
  expect(revisionOf('Plan')).toBe(0);

  await queueDialog(app, [original('sample.pdf', 'Appendix.pdf')]);
  await pagesMenu(page, 'Insert pages from a PDF…');
  await expect(thumbnails(page).getByRole('option')).toHaveCount(5);
  await save(page, 'Plan', 1);
  expect(await pagesText(storedBytes('Plan'))).toEqual([
    'Alpha page introduces the plan',
    'Bravo page lists the details',
    'Charlie page closes the summary',
    'Infinity Notes sample PDF',
    'Second page of the sample',
  ]);
});

test('search finds a PDF by the text of its pages', async () => {
  const { app, page } = await h.start();
  await importPdf(page, app, 'sample-pages.pdf', 'Quarterly plan.pdf');
  // The text of the pages is read in the background after the import; the search sees it once it is indexed.
  await expect.poll(() => h.one<{ body_text: string }>('SELECT body_text FROM documents WHERE title = ?', 'Quarterly plan')?.body_text).toContain('Charlie');
  await activate(page.getByRole('tab', { name: 'Home', exact: true }));
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox', { name: 'Type a command or search notes' }).fill('charlie');
  await expect(page.getByRole('option', { name: /Quarterly plan/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(tabItem(page, 'Quarterly plan')).toHaveAttribute('aria-selected', 'true');
});

test('a protected PDF asks for its password and never stores it; a damaged PDF says so', async () => {
  const { app, page } = await h.start();
  await importPdf(page, app, 'sample-protected.pdf', 'Secret.pdf');
  const prompt = page.getByRole('form', { name: 'PDF password' });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel('Password').fill('wrong password');
  await prompt.getByRole('button', { name: 'Open' }).click();
  await expect(prompt.getByRole('alert')).toHaveText('That password is not right. Try again.');
  await prompt.getByLabel('Password').fill('infinity');
  await prompt.getByRole('button', { name: 'Open' }).click();
  await expect(viewer(page).locator('.textLayer').first()).toContainText('Protected sample text');
  expect(h.one<{ body_text: string }>("SELECT body_text FROM documents WHERE title = 'Secret'")?.body_text).toBe('');
  // Neither a password nor the protected text reaches the database or its write-ahead log.
  for (const file of ['infinity-notes.sqlite3', 'infinity-notes.sqlite3-wal']) {
    const full = path.join(h.userData, 'data', file);
    if (!fs.existsSync(full)) continue;
    const stored = fs.readFileSync(full).toString('latin1');
    expect(stored, file).not.toContain('wrong password');
    expect(stored, file).not.toContain('Protected sample text');
  }

  await importPdf(page, app, 'sample-damaged.pdf', 'Broken.pdf');
  await expect(viewer(page).getByRole('alert')).toHaveText('This file is not a readable PDF. It may be damaged, or not a PDF at all.');
});
