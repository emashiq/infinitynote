import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chooseNoteMenu, dropDiskFiles, editor, focusEditorEnd, queueDialog, shellCalls, waitSaved } from './editor-ui';
import { useApp } from './harness';
import { COMMON, createNote, reloadUi } from './seed';
import { activate, openFromTree, railGo, tabItem, toasts } from './ui';

/** Copy into Infinity Notes or link to the original (D-108). */
const h = useApp({ failOnMainErrors: true });
const MB = 1024 * 1024;

const linkedRows = () => h.all<{ path: string; name: string }>('SELECT path, name FROM linked_files ORDER BY created_at, name');
const copiedNames = () => h.all<{ original_name: string }>('SELECT original_name FROM attachments ORDER BY original_name').map((r) => r.original_name);
const addFiles = (page: Page) => page.getByRole('dialog', { name: /^Add (file|\d+ files)$/ });
const linkedChips = (page: Page) => editor(page).locator('.file-chip-linked');
const copiedChips = (page: Page) => editor(page).locator('.file-chip:not(.file-chip-linked)');

let dir = '';
test.beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-files-')));
});
test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** An original outside the app's data; `size` makes a sparse file of that many bytes. */
function original(name: string, content: string | { size: number } = 'content'): string {
  const file = path.join(dir, name);
  if (typeof content === 'string') fs.writeFileSync(file, content);
  else {
    fs.writeFileSync(file, '');
    fs.truncateSync(file, content.size);
  }
  return file;
}

async function openNew(title: string) {
  const launched = await h.start();
  const id = await createNote(launched.page, COMMON, title);
  await reloadUi(launched.page);
  await openFromTree(launched.page, id);
  await focusEditorEnd(launched.page);
  return { ...launched, id };
}

test('Ask: a drop asks once; Link to the original links the file, Copy into Infinity Notes copies it', async () => {
  const { page, id } = await openNew('Project');
  const plan = original('plan.pdf', '%PDF-1.4 plan');
  await dropDiskFiles(page, [plan]);
  const dialog = addFiles(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'Files' })).toContainText('plan.pdf');
  await expect(dialog).toContainText('backups and exports keep only the link, not the file');
  await expect(editor(page).locator('.file-chip')).toContainText('Adding file…');
  await dialog.getByRole('button', { name: 'Link to the original' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(linkedChips(page)).toContainText('plan.pdf');
  await expect(linkedChips(page)).toContainText('Linked');
  await expect(linkedChips(page)).toHaveAttribute('title', `Linked: ${plan}`);
  await waitSaved(page);
  await expect.poll(linkedRows).toEqual([{ path: plan, name: 'plan.pdf' }]);
  expect(h.all('SELECT link_id FROM note_linked_files WHERE note_id = ?', id)).toHaveLength(1);
  expect(copiedNames()).toEqual([]);

  const notes = original('notes.txt', 'some notes');
  await dropDiskFiles(page, [notes]);
  await addFiles(page).getByRole('button', { name: 'Copy into Infinity Notes' }).click();
  await expect(copiedChips(page)).toContainText('notes.txt');
  await waitSaved(page);
  await expect.poll(copiedNames).toEqual(['notes.txt']);
  expect(linkedRows()).toHaveLength(1);
});

test('a file over 25 MB can only be linked: the dialog warns, Copy is not offered, and it is linked', async () => {
  const { app, page } = await openNew('Large');
  const video = original('holiday.mp4', { size: 26 * MB });
  await queueDialog(app, [video]);
  await chooseNoteMenu(page, 'Attach file');
  const dialog = addFiles(page);
  await expect(dialog).toContainText('holiday.mp4');
  await expect(dialog).toContainText('Larger than 25 MB: can only be linked');
  await expect(dialog.getByRole('button', { name: 'Copy into Infinity Notes' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Link to the original' }).click();
  await expect(linkedChips(page)).toContainText('holiday.mp4');
  await expect(linkedChips(page)).toContainText('26.0 MB');
  await waitSaved(page);
  await expect.poll(linkedRows).toEqual([{ path: video, name: 'holiday.mp4' }]);
  expect(copiedNames()).toEqual([]);
});

test('Remember my choice sets "When adding files"; Always link and Always copy then add without asking', async () => {
  const { page } = await openNew('Remembered');
  await dropDiskFiles(page, [original('a.pdf')]);
  const dialog = addFiles(page);
  await dialog.getByRole('checkbox', { name: 'Remember my choice' }).check();
  await dialog.getByRole('button', { name: 'Link to the original' }).click();
  await expect(linkedChips(page)).toHaveCount(1);
  await expect.poll(() => h.setting('attachments.addFiles')).toEqual({ v: 1, value: 'link' });

  await dropDiskFiles(page, [original('b.pdf')]);
  await expect(linkedChips(page)).toHaveCount(2);
  await expect(addFiles(page)).toHaveCount(0);

  await railGo(page, 'Settings');
  const select = page.getByLabel('When adding files');
  await expect(select).toHaveValue('link');
  await select.selectOption({ label: 'Always copy into Infinity Notes' });
  await expect.poll(() => h.setting('attachments.addFiles')).toEqual({ v: 1, value: 'copy' });
  await activate(tabItem(page, 'Remembered'));
  await expect(linkedChips(page)).toHaveCount(2);
  // Always copy: a file over 25 MB is linked instead, with a notice.
  await dropDiskFiles(page, [original('c.txt', 'copied'), original('big.iso', { size: 26 * MB })]);
  await expect(copiedChips(page)).toContainText('c.txt');
  await expect(linkedChips(page)).toHaveCount(3);
  await expect(toasts(page).filter({ hasText: 'big.iso is larger than 25 MB, so it was linked to the original instead of copied.' })).toBeVisible();
  await expect(addFiles(page)).toHaveCount(0);
});

test('a linked file opens through the validated hand-off; a program only shows in its folder; a missing file says where it was', async () => {
  const { app, page } = await openNew('Hand-off');
  const pdf = original('report.pdf', '%PDF-1.4 report');
  const exe = original('tool.exe', 'MZ');
  await queueDialog(app, [pdf, exe]);
  await chooseNoteMenu(page, 'Attach file');
  await addFiles(page).getByRole('button', { name: 'Link to the original' }).click();
  await expect(linkedChips(page)).toHaveCount(2);
  await waitSaved(page);

  // "Open" hands the file to the system app; a PDF also offers "Open report.pdf in Infinity Notes" (D-118).
  await editor(page).getByRole('button', { name: 'Open report.pdf', exact: true }).click();
  await expect.poll(async () => (await shellCalls(app)).filter((c) => c.op === 'openPath').map((c) => c.path)).toEqual([pdf]);
  await expect(editor(page).getByRole('button', { name: 'Open tool.exe' })).toHaveCount(0);
  await editor(page).getByRole('button', { name: 'Show tool.exe in folder' }).click();
  await expect.poll(async () => (await shellCalls(app)).filter((c) => c.op === 'showItemInFolder').map((c) => c.path)).toEqual([exe]);

  // Copy into Infinity Notes turns the link into a stored copy.
  await editor(page).getByRole('button', { name: 'Copy tool.exe into Infinity Notes' }).click();
  await expect(copiedChips(page)).toContainText('tool.exe');
  await expect(linkedChips(page)).toHaveCount(1);
  await waitSaved(page);
  await expect.poll(copiedNames).toEqual(['tool.exe']);

  fs.rmSync(pdf);
  await reloadUi(page);
  const missing = linkedChips(page);
  await expect(missing).toHaveClass(/is-missing/);
  await expect(missing).toContainText(`File not found at ${pdf}`);
  await expect(editor(page).getByRole('button', { name: 'Show report.pdf in folder' })).toBeDisabled();
  await expect(editor(page).getByRole('button', { name: /^Open report\.pdf/ })).toHaveCount(0);
});
