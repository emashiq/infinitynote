import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { blockedRequests, paletteAction, queueDialog, shellCalls } from './editor-ui';
import { useApp } from './harness';
import { activate, chooseMenu, dialogByName, expandRows, menuItem, tabItem, toasts, treeByKey, treeItem } from './ui';

/** Documents as tree items (D-118) and the read-only HTML viewer (F6). Written in Run 0; run at the end of release 0.3.0. */
const h = useApp({ failOnMainErrors: true });
const FIXTURES = path.resolve('tests/fixtures/documents');

let dir = '';
test.beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-documents-')));
});
test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A copy of a sample document outside the app's data, under the given name. */
function original(sample: string, name: string): string {
  const file = path.join(dir, name);
  fs.copyFileSync(path.join(FIXTURES, sample), file);
  return file;
}

const documentRows = () => h.all<{ id: string; title: string; kind: string; storage: string; deleted_at: number | null }>('SELECT id, title, kind, storage, deleted_at FROM documents ORDER BY created_at');
const documentView = (page: Page) => page.locator('.document-view');

/** "Import file…" from the palette, answering the "Add file" question. */
async function importFile(page: Page, app: Parameters<typeof queueDialog>[0], file: string, answer: 'Copy into Infinity Notes' | 'Link to the original') {
  await queueDialog(app, [file]);
  await paletteAction(page, 'Import file…');
  const dialog = dialogByName(page, 'Add file');
  await expect(dialog).toBeVisible();
  await activate(dialog.getByRole('button', { name: answer }));
  await expect(dialog).toHaveCount(0);
}

test('import by copy: the document joins the tree, opens in a tab and is stored in Infinity Notes', async () => {
  const { app, page } = await h.start();
  await importFile(page, app, original('sample.pdf', 'Quarterly figures.pdf'), 'Copy into Infinity Notes');
  await expect.poll(documentRows).toMatchObject([{ title: 'Quarterly figures', kind: 'pdf', storage: 'managed' }]);
  await expect(tabItem(page, 'Quarterly figures')).toHaveAttribute('aria-selected', 'true');
  await expect(treeItem(page, 'Quarterly figures')).toBeVisible();
  await expect(documentView(page).locator('.document-kind')).toHaveText('PDF');
  await activate(documentView(page).getByRole('button', { name: 'Open in system app' }));
  await expect.poll(async () => (await shellCalls(app)).map((c) => c.op)).toContain('openPath');
});

test('new blank Word document, spreadsheet and presentation open in tabs and are valid files', async () => {
  const { page } = await h.start();
  await paletteAction(page, 'New Word document');
  await expect(tabItem(page, 'Untitled document')).toHaveAttribute('aria-selected', 'true');
  await paletteAction(page, 'New spreadsheet');
  await paletteAction(page, 'New presentation');
  await expect.poll(() => documentRows().map((r) => r.kind)).toEqual(['docx', 'xlsx', 'pptx']);
  // Every kind has a viewer since the PowerPoint viewer (F5): the new presentation opens in it.
  await expect(page.getByRole('toolbar', { name: 'Presentation' })).toBeVisible();
  await expect(page.locator('[aria-roledescription="slide"]')).toHaveAttribute('aria-label', /^Slide 1 of \d+$/);
});

test('HTML viewer: the page shows in a sandboxed frame, its script never runs and nothing reaches the network', async () => {
  const { app, page } = await h.start();
  await importFile(page, app, original('sample.html', 'Saved page.html'), 'Link to the original');
  const frame = page.locator('iframe.html-frame');
  await expect(frame).toHaveAttribute('sandbox', '');
  const content = page.frameLocator('iframe.html-frame');
  await expect(content.locator('h1')).toHaveText('Sample web page');
  // The page's script would have renamed the document and fetched a beacon.
  expect(await content.locator('title').textContent()).toBe('Sample page title');
  // Remote styles, images and the beacon are stopped by the frame's policy before the network guard would see them.
  expect((await blockedRequests(app)).filter((u) => u.includes('example.com'))).toEqual([]);
  // A link click goes nowhere: the frame keeps its page.
  await content.getByRole('link', { name: 'external link' }).click();
  await expect(toasts(page).filter({ hasText: 'Links in a saved page do not open. Copy them from Links.' })).toBeVisible();
  await expect(content.locator('h1')).toHaveText('Sample web page');
  expect(await frame.getAttribute('src')).toMatch(/^infinity-html:\/\/[0-9a-f-]{36}\/\?r=0$/);

  await activate(page.getByRole('radio', { name: 'Source' }));
  await expect(page.locator('.html-source')).toContainText('<script>document.title');
  await activate(page.getByRole('button', { name: 'Links (1)' }));
  await expect(menuItem(page, 'Copy https://example.com/docs')).toBeVisible();
});

test('search finds a document by the text inside it and opens it', async () => {
  const { app, page } = await h.start();
  await importFile(page, app, original('sample.pptx', 'Launch plan.pptx'), 'Copy into Infinity Notes');
  // The text inside is read in the background after the import; the search sees it once it is indexed.
  await expect.poll(() => h.one<{ body_text: string }>('SELECT body_text FROM documents WHERE title = ?', 'Launch plan')?.body_text?.toLowerCase()).toContain('roadmap');
  await activate(page.getByRole('tab', { name: 'Home', exact: true }));
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox', { name: 'Type a command or search notes' }).fill('roadmap');
  const option = page.getByRole('option', { name: /Launch plan/ });
  await expect(option).toBeVisible();
  await expect(page.locator('.group-label', { hasText: 'Documents' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(tabItem(page, 'Launch plan')).toHaveAttribute('aria-selected', 'true');
});

test('Move to Trash closes the tab; Restore brings the document back where it was', async () => {
  const { app, page } = await h.start();
  await importFile(page, app, original('sample.docx', 'Report.docx'), 'Copy into Infinity Notes');
  await expect.poll(documentRows).toHaveLength(1);
  const id = documentRows()[0]!.id;
  await chooseMenu(page, treeByKey(page, `document:${id}`), 'Move to Trash');
  await activate(dialogByName(page, /Move to Trash/).getByRole('button', { name: 'Move to Trash' }));
  await expect(tabItem(page, 'Report')).toHaveCount(0);
  await expect.poll(() => documentRows()[0]?.deleted_at).not.toBeNull();
  await expandRows(page, ['trash']);
  const trashed = page.locator('[id^="tree-trash:"]:not([id="tree-trash:empty"])', { hasText: 'Report' });
  await chooseMenu(page, trashed, 'Restore');
  await expect.poll(() => documentRows()[0]?.deleted_at).toBeNull();
  await expect(treeByKey(page, `document:${id}`)).toBeVisible();
});
