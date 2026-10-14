import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chooseNoteMenu, editor, paletteAction, queueDialog, shellCalls } from './editor-ui';
import { useApp } from './harness';
import { queueSave, settingsSection } from './portability-ui';
import { COMMON, createNote, reloadUi } from './seed';
import { activate, dialogByName, openFromTree, tabItem, toasts } from './ui';

/** Word, spreadsheet and PowerPoint documents turned off (D-187): the default, and what stays possible. */
const h = useApp({ failOnMainErrors: true });
const FIXTURES = path.resolve('tests/fixtures/documents');
const OFFICE_LABEL = 'Office documents (Word, spreadsheets, PowerPoint)';
const PANEL_TITLE = 'Word, spreadsheet and PowerPoint editing is turned off';

let dir = '';
test.beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-office-')));
});
test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function original(sample: string, name: string): string {
  const file = path.join(dir, name);
  fs.copyFileSync(path.join(FIXTURES, sample), file);
  return file;
}

const documentRows = () => h.all<{ title: string; kind: string }>('SELECT title, kind FROM documents WHERE deleted_at IS NULL ORDER BY created_at');
const officeSwitch = (page: Page) => settingsSection(page, 'Documents').getByRole('switch', { name: OFFICE_LABEL });

async function ready(page: Page) {
  await page.locator('#app-shell[data-ready="true"]').waitFor();
}

async function importFile(page: Page, app: ElectronApplication, file: string) {
  await queueDialog(app, [file]);
  await paletteAction(page, 'Import file…');
  const dialog = dialogByName(page, 'Add file');
  await activate(dialog.getByRole('button', { name: 'Copy into Infinity Notes' }));
  await expect(dialog).toHaveCount(0);
}

test('off by default: no new Word document, spreadsheet or presentation anywhere; Office files are not imported', async () => {
  const { app, page } = await h.start();
  await ready(page);
  await page.keyboard.press('Control+K');
  const search = page.getByRole('combobox', { name: 'Type a command or search notes' });
  await search.fill('New');
  await expect(page.getByRole('option', { name: /^New note/ })).toBeVisible();
  for (const label of ['New Word document', 'New spreadsheet', 'New presentation']) await expect(page.getByRole('option', { name: new RegExp(label) })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await activate(page.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'File' }));
  const file = page.getByRole('menu', { name: 'File' });
  await expect(file.getByRole('menuitem', { name: 'Import file…' })).toBeVisible();
  await expect(file.getByRole('menuitem', { name: /^New (Word|spreadsheet|presentation)/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Main refuses too, whatever the window asks.
  const created = await page.evaluate(() => window.infinity.document.create({ location: { projectId: null, folderId: null }, kind: 'docx' }));
  expect(created).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

  // An Office file picked for import is refused with the reason; a PDF next to it is added.
  await queueDialog(app, [original('sample.xlsx', 'Budget.xlsx'), original('sample.pdf', 'Paper.pdf')]);
  await paletteAction(page, 'Import file…');
  await expect(toasts(page).filter({ hasText: 'Word, spreadsheet and PowerPoint editing is turned off, so these files are not added as documents.' })).toBeVisible();
  await activate(dialogByName(page, 'Add file').getByRole('button', { name: 'Copy into Infinity Notes' }));
  await expect.poll(documentRows).toEqual([{ title: 'Paper', kind: 'pdf' }]);

  await paletteAction(page, 'Open Settings');
  await expect(officeSwitch(page)).toHaveAttribute('aria-checked', 'false');
});

test('an existing Word document shows the panel: system app and a copy work, and turning it on opens the editor', async () => {
  const { app, page } = await h.start();
  await ready(page);
  await page.evaluate(() => window.infinity.settings.set({ key: 'documents.office', value: true }));
  await importFile(page, app, original('sample.docx', 'Plan.docx'));
  await expect(page.locator('.docx-viewer')).toBeVisible();

  // Turned off in Settings: the open tab shows the panel instead of the editor, and the document stays.
  await paletteAction(page, 'Open Settings');
  await activate(officeSwitch(page));
  await expect(officeSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => h.setting('documents.office')).toEqual({ v: 1, value: false });
  await activate(tabItem(page, 'Plan'));
  const panel = page.locator('.office-off');
  await expect(panel.getByRole('heading', { name: PANEL_TITLE })).toBeVisible();
  await expect(page.locator('.docx-viewer')).toHaveCount(0);
  expect(documentRows()).toEqual([{ title: 'Plan', kind: 'docx' }]);

  await activate(panel.getByRole('button', { name: 'Open with the system app' }));
  await expect.poll(async () => (await shellCalls(app)).map((c) => c.op)).toContain('openPath');
  const copy = path.join(dir, 'Plan copy.docx');
  await queueSave(app, copy);
  await activate(panel.getByRole('button', { name: 'Save a copy…' }));
  await expect.poll(() => fs.existsSync(copy)).toBe(true);
  expect(fs.readFileSync(copy)).toEqual(fs.readFileSync(original('sample.docx', 'check.docx')));

  // "Turn on in Settings" opens Settings at the switch; turning it on shows the editor again.
  await activate(panel.getByRole('button', { name: 'Turn on in Settings' }));
  await expect(officeSwitch(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(officeSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await activate(tabItem(page, 'Plan'));
  await expect(page.locator('.docx-viewer')).toBeVisible();
  await expect(page.locator('.office-off')).toHaveCount(0);
});

test('a Word file attached to a note stays a file: no "Open in Infinity Notes" while Office documents are off', async () => {
  const { app, page } = await h.start();
  await ready(page);
  const noteId = await createNote(page, COMMON, 'Minutes');
  await reloadUi(page);
  await openFromTree(page, noteId);
  const file = original('sample.docx', 'Agenda.docx');
  await queueDialog(app, [file]);
  await chooseNoteMenu(page, 'Attach file');
  await activate(dialogByName(page, 'Add file').getByRole('button', { name: 'Copy into Infinity Notes' }));
  await expect(editor(page).getByRole('button', { name: 'Open Agenda.docx', exact: true })).toBeVisible();
  await expect(editor(page).getByRole('button', { name: 'Open Agenda.docx in Infinity Notes' })).toHaveCount(0);
  await activate(editor(page).getByRole('button', { name: 'Open Agenda.docx', exact: true }));
  await expect.poll(async () => (await shellCalls(app)).filter((c) => c.op === 'openPath')).toHaveLength(1);

  // With Office documents on, a note opened again offers it.
  await page.evaluate(() => window.infinity.settings.set({ key: 'documents.office', value: true }));
  await reloadUi(page);
  await expect(editor(page).getByRole('button', { name: 'Open Agenda.docx in Infinity Notes' })).toBeVisible();
});
