import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { paletteAction, queueDialog } from './editor-ui';
import { useApp } from './harness';
import { activate, dialogByName, tabItem, toasts, treeByKey, treeItem } from './ui';

/**
 * Renaming documents with their viewer open (D-182): from the tree's context menu (the v0.3.0 defect: its field closed
 * at once), from the tab (F2, double-click) and from the document header, for a spreadsheet, a Word document, a PDF and a presentation.
 */
// Word, spreadsheet and PowerPoint documents are off by default (D-187); these tests use them.
const h = useApp({ failOnMainErrors: true, settings: { 'documents.office': true } });
const FIXTURES = path.resolve('tests/fixtures/documents');

let dir = '';
test.beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-rename-')));
});
test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const titleOf = (id: string) => h.one<{ title: string }>('SELECT title FROM documents WHERE id = ?', id)?.title;
const header = (page: Page) => page.locator('.document-header');

/** Imports a copy of a sample under `name` and waits for its viewer; returns the document ID. */
async function openSample(page: Page, app: ElectronApplication, sample: string, name: string): Promise<string> {
  const file = path.join(dir, name);
  fs.copyFileSync(path.join(FIXTURES, sample), file);
  await queueDialog(app, [file]);
  await paletteAction(page, 'Import file…');
  const dialog = dialogByName(page, 'Add file');
  await activate(dialog.getByRole('button', { name: 'Copy into Infinity Notes' }));
  await expect(dialog).toHaveCount(0);
  const title = path.basename(name, path.extname(name));
  await expect(tabItem(page, title)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => h.one<{ id: string }>('SELECT id FROM documents WHERE title = ?', title)?.id).toBeTruthy();
  return h.one<{ id: string }>('SELECT id FROM documents WHERE title = ?', title)!.id;
}

/** The name shows the same everywhere: database, tree, tab and header. */
async function expectNamed(page: Page, id: string, name: string) {
  await expect.poll(() => titleOf(id)).toBe(name);
  await expect(treeByKey(page, `document:${id}`).locator('.tree-label')).toHaveText(name);
  await expect(tabItem(page, name)).toBeVisible();
  await expect(header(page).getByRole('heading', { name })).toBeVisible();
}

async function typeName(field: Locator, name: string) {
  await expect(field).toBeFocused();
  await field.press('Control+A');
  await field.pressSequentially(name);
  await field.press('Enter');
}

for (const { sample, name, viewer } of [
  { sample: 'sample.xlsx', name: 'Budget.xlsx', viewer: '.spreadsheet-grid .fortune-sheet-overlay' },
  { sample: 'sample.docx', name: 'Report.docx', viewer: '.docx-viewer' },
  { sample: 'sample.pdf', name: 'Figures.pdf', viewer: '.pdf-viewer' },
  { sample: 'sample.pptx', name: 'Launch.pptx', viewer: '.pptx-viewer' },
]) {
  test(`${sample}: rename from the tree menu, the tab and the header while the viewer is open`, async () => {
    const { app, page } = await h.start();
    const id = await openSample(page, app, sample, name);
    await expect(page.locator(viewer).first()).toBeVisible();
    const row = treeByKey(page, `document:${id}`);

    // Tree: right-click, Rename, type. The field stays open and takes the typing.
    await row.click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await typeName(page.getByRole('textbox', { name: 'Rename' }), 'From the tree');
    await expectNamed(page, id, 'From the tree');
    await expect(row).toBeFocused();

    // Tab: F2 renames; an empty name is refused with the tree's message and the field stays.
    const tab = tabItem(page, 'From the tree');
    await tab.focus();
    await tab.press('F2');
    const tabField = page.locator('.tab-rename');
    await expect(tabField).toBeFocused();
    await tabField.press('Control+A');
    await tabField.press('Delete');
    await tabField.press('Enter');
    await expect(toasts(page).filter({ hasText: 'Names must be 1 to 200 characters' })).toBeVisible();
    await expect(tabField).toBeVisible();
    await typeName(tabField, 'From the tab');
    await expectNamed(page, id, 'From the tab');

    // Tab: double-click.
    await tabItem(page, 'From the tab').dblclick();
    await typeName(page.locator('.tab-rename'), 'Double-clicked');
    await expectNamed(page, id, 'Double-clicked');

    // Header: click the title.
    await header(page).getByRole('button', { name: 'Double-clicked' }).click();
    await typeName(header(page).getByRole('textbox', { name: 'Document name' }), 'From the header');
    await expectNamed(page, id, 'From the header');

    // Header: F2 on the title, and the Rename action.
    const title = header(page).getByRole('button', { name: 'From the header' });
    await title.focus();
    await title.press('F2');
    await typeName(header(page).getByRole('textbox', { name: 'Document name' }), 'By key');
    await expectNamed(page, id, 'By key');
    await header(page).getByRole('button', { name: 'Rename', exact: true }).click();
    await typeName(header(page).getByRole('textbox', { name: 'Document name' }), 'Final name');
    await expectNamed(page, id, 'Final name');

    // F2 on the tree row with the viewer open still renames.
    await treeItem(page, 'Final name').focus();
    await treeItem(page, 'Final name').press('F2');
    await typeName(page.getByRole('textbox', { name: 'Rename' }), 'Renamed once more');
    await expectNamed(page, id, 'Renamed once more');

    // Search finds it by the new name.
    await page.keyboard.press('Control+K');
    await page.getByRole('combobox', { name: 'Type a command or search notes' }).fill('Renamed once more');
    await expect(page.getByRole('option', { name: /Renamed once more/ })).toBeVisible();
    await page.keyboard.press('Escape');
  });
}

test('a note renamed from the tree menu keeps its field open (the same defect)', async () => {
  const { page } = await h.start();
  const id = await page.evaluate(async () => {
    const res = await window.infinity.note.create({ location: { projectId: null, folderId: null }, sticky: false, title: 'Plan' });
    return res.ok ? res.data.note.id : '';
  });
  const row = treeByKey(page, `note:${id}`);
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await typeName(page.getByRole('textbox', { name: 'Rename' }), 'Plan B');
  await expect.poll(() => h.one<{ title: string }>('SELECT title FROM notes WHERE id = ?', id)?.title).toBe('Plan B');
  await expect(row.locator('.tree-label')).toHaveText('Plan B');
});
