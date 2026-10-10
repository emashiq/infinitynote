import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clipboardHtml, paletteAction, queueDialog, seedClipboardHtml } from './editor-ui';
import { useApp } from './harness';
import { queueSave } from './portability-ui';
import { activate, dialogByName, tabItem } from './ui';

/**
 * The spreadsheet viewer and editor (F3, D-134..D-141) and the Versions panel. Written in Run 2; run in WSL under Xvfb
 * and on CI at the end of release 0.3.0. The grid is FortuneSheet's canvas, so cells are reached by position: the
 * first cell sits right of the row headers (46 px) and below the column headers (20 px).
 */
const h = useApp({ failOnMainErrors: true });
const FIXTURES = path.resolve('tests/fixtures/documents');
const CELL = { width: 73, height: 19 };

let dir = '';
test.beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-sheet-')));
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

/** The stored bytes of a managed document's current revision. */
function storedFile(title: string): string {
  const row = h.one<{ relative_path: string }>('SELECT b.relative_path FROM documents d JOIN document_blobs b ON b.id = d.blob_id WHERE d.title = ? AND d.deleted_at IS NULL', title)!;
  return path.join(h.userData, 'data', row.relative_path);
}
const revisionOf = (title: string) => h.one<{ revision: number }>('SELECT revision FROM documents WHERE title = ? AND deleted_at IS NULL', title)?.revision;

async function savedSheet(title: string, sheet = 0): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(storedFile(title));
  return wb.worksheets[sheet]!;
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Spreadsheet' });
const status = (page: Page) => toolbar(page).getByRole('status');
const cellArea = (page: Page) => page.locator('.spreadsheet-grid .fortune-sheet-overlay');

/** Clicks the cell at zero-based (row, col) of the visible grid. */
async function clickCell(page: Page, row: number, col: number, button: 'left' | 'right' = 'left') {
  await cellArea(page).click({ position: { x: 46 + col * CELL.width + 10, y: 20 + row * CELL.height + 8 }, button });
}

async function typeInto(page: Page, row: number, col: number, text: string) {
  await clickCell(page, row, col);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

async function saveAndWait(page: Page, title: string, revision: number) {
  await expect(status(page)).toHaveText('Unsaved changes');
  await page.keyboard.press('Control+S');
  await expect.poll(() => revisionOf(title)).toBe(revision);
  await expect(status(page)).toHaveText('');
}

async function openSpreadsheet(page: Page, app: ElectronApplication, sample = 'sample.xlsx', name = 'Budget.xlsx') {
  await importFile(page, app, copyFixture(sample, name));
  const title = path.basename(name, path.extname(name));
  await expect(tabItem(page, title)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.spreadsheet-grid canvas').first()).toBeVisible();
  return title;
}

test('opens a workbook, edits cells and formulas, and saves an xlsx that keeps them', async () => {
  const { app, page } = await h.start();
  const title = await openSpreadsheet(page, app);
  await typeInto(page, 5, 0, 'Receipts');
  await typeInto(page, 5, 1, '=B2*2');
  await saveAndWait(page, title, 1);
  const ws = await savedSheet(title);
  expect(ws.getCell('A6').value).toBe('Receipts');
  expect(ws.getCell('B6').formula).toBe('B2*2');
  expect(ws.getCell('B6').result).toBe(Number(ws.getCell('B2').value) * 2);
  // The search index has the new text.
  expect(h.one<{ body_text: string }>('SELECT body_text FROM documents WHERE title = ?', title)!.body_text).toContain('Receipts');
});

test('inserting rows works under the app’s CSP (the build replaced FortuneSheet’s new Function, D-139)', async () => {
  const { app, page } = await h.start();
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|unsafe-eval/i.test(m.text())) violations.push(m.text());
  });
  const title = await openSpreadsheet(page, app);
  const first = (await savedSheet(title)).getCell('A1').value;
  await clickCell(page, 0, 0, 'right');
  // FortuneSheet's menu items act on a click ("Insert 1 Row Above"; a click on the count field would only edit it).
  await page.locator('.fortune-context-menu .luckysheet-cols-menuitem', { hasText: /Insert.*Row.*Above/ }).locator('.luckysheet-cols-rows-shift-top').click();
  await saveAndWait(page, title, 1);
  const ws = await savedSheet(title);
  expect(ws.getCell('A1').value).toBeNull();
  expect(ws.getCell('A2').value).toBe(first);
  expect(violations).toEqual([]);
});

test('a workbook with features the model does not keep says so, and asks before its first save', async () => {
  const { app, page } = await h.start();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Rules');
  ws.getCell('A1').value = 'Pick';
  ws.getCell('A2').dataValidation = { type: 'list', allowBlank: true, formulae: ['"yes,no"'] };
  const file = path.join(dir, 'Rules.xlsx');
  await wb.xlsx.writeFile(file);
  await importFile(page, app, file);
  await expect(page.locator('.spreadsheet-simplified')).toContainText('Data validation');
  await typeInto(page, 2, 0, 'changed');
  await page.keyboard.press('Control+S');
  const notice = dialogByName(page, 'Saving simplifies this workbook');
  await expect(notice).toContainText('Data validation (drop-down lists and input rules)');
  await activate(notice.getByRole('button', { name: 'Cancel' }));
  expect(revisionOf('Rules')).toBe(0);
  await page.keyboard.press('Control+S');
  await activate(dialogByName(page, 'Saving simplifies this workbook').getByRole('button', { name: 'Save without them' }));
  await expect.poll(() => revisionOf('Rules')).toBe(1);
  await expect(page.locator('.spreadsheet-simplified')).toHaveCount(0);
});

test('a CSV keeps its separator and byte-order mark, saved back to the linked original', async () => {
  const { app, page } = await h.start();
  const file = path.join(dir, 'Prices.csv');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('name;amount\r\nTea;4\r\n')]));
  await importFile(page, app, file, 'Link to the original');
  await expect(toolbar(page)).toContainText('CSV files keep values only');
  await expect(page.locator('.spreadsheet-grid .fortune-sheettab-container')).toHaveCount(0);
  await typeInto(page, 2, 0, 'Coffee');
  await saveAndWait(page, 'Prices', 1);
  expect(fs.readFileSync(file)).toEqual(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('name;amount\r\nTea;4\r\nCoffee;\r\n')]));
});

test('find goes to matching cells; copy puts TSV and HTML on the system clipboard', async () => {
  const { app, page } = await h.start();
  await openSpreadsheet(page, app);
  await page.keyboard.press('Control+F');
  const find = page.getByRole('searchbox', { name: 'Find in spreadsheet' });
  await expect(find).toBeFocused();
  await find.fill('coffee');
  await expect(page.locator('.document-find-count')).toHaveText('1 of 1');
  await find.press('Escape');
  await clickCell(page, 0, 0);
  await page.keyboard.down('Shift');
  await clickCell(page, 1, 1);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Control+C');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/\t/);
  await expect.poll(() => clipboardHtml(app)).toMatch(/<table/i);
});

test('pasting a table from the clipboard fills cells', async () => {
  const { app, page } = await h.start();
  const title = await openSpreadsheet(page, app);
  await seedClipboardHtml(app, '<table><tr><td>x</td><td>y</td></tr><tr><td>1</td><td>2</td></tr></table>', 'x\ty\n1\t2');
  await clickCell(page, 7, 0);
  await page.keyboard.press('Control+V');
  await saveAndWait(page, title, 1);
  const ws = await savedSheet(title);
  expect([ws.getCell('A8').value, ws.getCell('B8').value, ws.getCell('A9').value, ws.getCell('B9').value].map(String)).toEqual(['x', 'y', '1', '2']);
});

test('closing the tab saves edits first', async () => {
  const { app, page } = await h.start();
  const title = await openSpreadsheet(page, app);
  await typeInto(page, 6, 0, 'kept on close');
  await page.keyboard.press('Control+W');
  await expect(tabItem(page, title)).toHaveCount(0);
  await expect.poll(() => revisionOf(title)).toBe(1);
  expect((await savedSheet(title)).getCell('A7').value).toBe('kept on close');
});

test('Versions: open an earlier version read-only, restore it, and save it as a copy', async () => {
  const { app, page } = await h.start();
  const title = await openSpreadsheet(page, app);
  const original = fs.readFileSync(storedFile(title));
  await typeInto(page, 5, 0, 'second');
  await saveAndWait(page, title, 1);
  await activate(page.getByRole('button', { name: 'Versions' }));
  const panel = page.getByRole('complementary', { name: 'Versions' });
  await expect(panel.locator('.version-row')).toHaveCount(1);
  await activate(panel.getByRole('button', { name: 'Open' }));
  await expect(page.locator('.document-version-banner')).toContainText('Revision 0 from');
  await expect(status(page)).toHaveText('Read-only');
  await activate(page.locator('.document-version-banner').getByRole('button', { name: 'Restore this version' }));
  await expect.poll(() => revisionOf(title)).toBe(2);
  expect(fs.readFileSync(storedFile(title))).toEqual(original);
  await expect(panel.locator('.version-row')).toHaveCount(2);
  await activate(panel.locator('.version-row').first().getByRole('button', { name: 'Save as copy' }));
  await expect(tabItem(page, `${title} (revision 1)`)).toHaveAttribute('aria-selected', 'true');
});

test('Export a copy writes the saved bytes to the chosen file', async () => {
  const { app, page } = await h.start();
  const title = await openSpreadsheet(page, app);
  const target = path.join(dir, 'Exported.xlsx');
  await queueSave(app, target);
  await activate(page.getByRole('button', { name: 'Export a copy…' }));
  await expect.poll(() => fs.existsSync(target)).toBe(true);
  expect(fs.readFileSync(target)).toEqual(fs.readFileSync(storedFile(title)));
});
