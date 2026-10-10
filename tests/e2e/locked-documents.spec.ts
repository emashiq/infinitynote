import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { paletteAction, queueDialog } from './editor-ui';
import { useApp } from './harness';
import { activate, dialogByName, tabItem, treeByKey, treeItem } from './ui';

/**
 * Locked documents (D-185): locking from the tree, the ciphertext at rest, the lock screen in the tab, an unlocked
 * document reopening at once, locking again after the idle time (the lock clock of the test hooks), Lock now and Lock
 * all, and a linked file copied in to be locked.
 */
const h = useApp({ failOnMainErrors: true });
const FIXTURES = path.resolve('tests/fixtures/documents');
const PASSWORD = 'correct horse battery';

let dir = '';
test.beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-locked-docs-')));
});
test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const lockScreen = (page: Page) => page.locator('.document-view .lock-screen');
const header = (page: Page) => page.locator('.document-header');
/** A document's tab by its ID (a locked one's name also says "Locked"). */
const documentTab = (page: Page, id: string) => page.locator(`[id="tab-document:${id}"]`);
const documentId = (title: string) => h.one<{ id: string }>('SELECT id FROM documents WHERE title = ?', title)!.id;

async function importSample(page: Page, app: ElectronApplication, sample: string, name: string, how: 'Copy into Infinity Notes' | 'Link to the original'): Promise<string> {
  const file = path.join(dir, name);
  fs.copyFileSync(path.join(FIXTURES, sample), file);
  await queueDialog(app, [file]);
  await paletteAction(page, 'Import file…');
  const dialog = dialogByName(page, 'Add file');
  await activate(dialog.getByRole('button', { name: how }));
  await expect(dialog).toHaveCount(0);
  const title = path.basename(name, path.extname(name));
  await expect(tabItem(page, title)).toHaveAttribute('aria-selected', 'true');
  return file;
}

async function lockFromTree(page: Page, title: string, submit: string) {
  await treeItem(page, title).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Lock…', exact: true }).click();
  const dialog = dialogByName(page, `Lock “${title}”`);
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Repeat password').fill(PASSWORD);
  await dialog.getByRole('checkbox', { name: 'I understand a forgotten password cannot be recovered' }).check();
  await dialog.getByRole('button', { name: submit }).click();
  await expect(dialog).toBeHidden();
}

async function unlock(page: Page) {
  await lockScreen(page).getByPlaceholder('Password').fill(PASSWORD);
  await lockScreen(page).getByRole('button', { name: 'Unlock' }).click();
  await expect(lockScreen(page)).toHaveCount(0);
}

test('a locked document is ciphertext at rest, opens at once while unlocked, and locks again after the idle time, Lock now and Lock all', async () => {
  const { app, page } = await h.start();
  await importSample(page, app, 'sample.docx', 'Report.docx', 'Copy into Infinity Notes');
  const id = documentId('Report');
  await expect(page.locator('.docx-viewer')).toBeVisible();
  await expect.poll(() => h.one<{ body_text: string }>('SELECT body_text FROM documents WHERE id = ?', id)?.body_text).toContain('twelve');

  await lockFromTree(page, 'Report', 'Lock document');
  await expect(lockScreen(page)).toContainText('This document is locked.');
  await expect(page.locator('.docx-viewer')).toHaveCount(0);
  await expect(treeByKey(page, `document:${id}`).getByRole('img', { name: 'Locked' })).toBeVisible();
  await expect(documentTab(page, id).getByRole('img', { name: 'Locked' })).toBeVisible();

  // At rest: one sealed blob, no plaintext in it, no versions, no search text, nothing served.
  const row = h.one<{ locked: number; body_text: string; relative_path: string; sealed: number }>(
    'SELECT d.locked, d.body_text, b.relative_path, b.sealed FROM documents d JOIN document_blobs b ON b.id = d.blob_id WHERE d.id = ?',
    id,
  )!;
  expect(row).toMatchObject({ locked: 1, body_text: '', sealed: 1 });
  const stored = fs.readFileSync(path.join(h.userData, 'data', row.relative_path));
  expect(stored.subarray(0, 2).toString('latin1')).not.toBe('PK');
  expect(stored.includes(Buffer.from('word/document.xml'))).toBe(false);
  expect(h.all('SELECT id FROM document_blobs WHERE sealed = 0')).toEqual([]);
  expect(h.all('SELECT id FROM document_versions WHERE document_id = ?', id)).toEqual([]);
  expect(h.one<{ n: number }>("SELECT count(*) AS n FROM documents_fts WHERE documents_fts MATCH 'twelve'")!.n).toBe(0);
  const served = await page.evaluate(async (url) => (await fetch(url)).status, `infinity-document://${id}/`);
  expect(served).toBe(403);

  // Unlocked: the viewer is back; closed and opened again it opens at once, without the password.
  await unlock(page);
  await expect(page.locator('.docx-viewer')).toBeVisible();
  await page.keyboard.press('Control+W');
  await expect(documentTab(page, id)).toHaveCount(0);
  await treeItem(page, 'Report').click();
  await expect(page.locator('.docx-viewer')).toBeVisible();
  await expect(lockScreen(page)).toHaveCount(0);

  // Five minutes without use (the default idle time) lock it again.
  await app.evaluate(() => globalThis.__infinityTest!.locks.idle(4 * 60_000));
  await expect(page.locator('.docx-viewer')).toBeVisible();
  await app.evaluate(() => globalThis.__infinityTest!.locks.idle(2 * 60_000));
  await expect(lockScreen(page)).toBeVisible();

  await unlock(page);
  await header(page).getByRole('button', { name: 'Lock now', exact: true }).click();
  await expect(lockScreen(page)).toBeVisible();

  await unlock(page);
  await paletteAction(page, 'Lock all notes and documents');
  await expect(lockScreen(page)).toBeVisible();
  await expect(header(page).getByRole('button', { name: 'Open in system app' })).toBeDisabled();
});

test('a linked file is copied in to be locked; the original stays where it is', async () => {
  const { app, page } = await h.start();
  const original = await importSample(page, app, 'sample.pdf', 'Contract.pdf', 'Link to the original');
  await lockFromTree(page, 'Contract', 'Copy in and lock');
  await expect(lockScreen(page)).toBeVisible();
  expect(h.one<{ storage: string; locked: number }>('SELECT storage, locked FROM documents WHERE title = ?', 'Contract')).toEqual({ storage: 'managed', locked: 1 });
  expect(fs.readFileSync(original)).toEqual(fs.readFileSync(path.join(FIXTURES, 'sample.pdf')));
  await unlock(page);
  await expect(page.locator('.pdf-viewer')).toBeVisible();
});
