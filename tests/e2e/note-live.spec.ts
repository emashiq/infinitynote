import { expect, test, type Page } from '@playwright/test';
import { setContentSize } from './fixtures';
import { useApp } from './harness';
import { COMMON, createFolder, createNote, createProject, reloadUi, trashFolder } from './seed';
import { activeTab, chooseMenu, expandRows, openFromTree, renameActiveTab, tabItem, titleInput, toasts, treeByKey } from './ui';

const h = useApp();
type Res = { ok: boolean; data?: { items?: Array<{ id: string; batchId: string }> }; error?: { code: string; message: string } };
interface BridgeMethods {
  [ns: string]: Record<string, (arg?: unknown) => Promise<Res>>;
}
async function call(page: Page, ns: string, method: string, arg?: unknown): Promise<Res> {
  return page.evaluate(([n, m, a]) => (window.infinity as unknown as BridgeMethods)[n as string]![m as string]!(a), [ns, method, arg] as const);
}

test('an open note follows rename, folder rename and move done elsewhere (QA-P02-1)', async () => {
  const { page, app } = await h.start();
  await setContentSize(app, page, 1300, 800);
  const a = await createProject(page, 'Alpha');
  const f = await createFolder(page, { projectId: a, parentId: null }, 'Fold');
  const n = await createNote(page, { projectId: a, folderId: f }, 'Old title');
  await reloadUi(page);
  await expandRows(page, [`project:${a}`, `folder:${f}`]);
  await openFromTree(page, n);
  // The note view is only the title and the text (D-102); the location is in the Details panel's Info.
  await page.keyboard.press('Control+Shift+Backslash');
  const panel = page.getByRole('complementary', { name: 'Details' });
  const location = panel.locator('dt', { hasText: /^Location$/ }).locator('xpath=following-sibling::dd[1]');
  await expect(activeTab(page)).toHaveText('Old title');
  await expect(location).toHaveText('Alpha › Fold');

  const row = treeByKey(page, `note:${n}`);
  await row.focus();
  await row.press('F2');
  const input = page.getByRole('textbox', { name: 'Rename' });
  await input.fill('Tree renamed');
  await input.press('Enter');
  await expect(tabItem(page, 'Tree renamed')).toBeVisible();
  await expect(activeTab(page)).toHaveText('Tree renamed');
  await expect(panel).toContainText('Tree renamed');

  await call(page, 'folder', 'rename', { folderId: f, name: 'Renamed folder' });
  await expect(location).toHaveText('Alpha › Renamed folder');

  const b = await createProject(page, 'Beta');
  await call(page, 'note', 'move', { noteId: n, target: { projectId: b, folderId: null } });
  await expect(location).toHaveText('Beta');
  await call(page, 'note', 'move', { noteId: n, target: COMMON });
  await expect(location).toHaveText('Common');
});

test('an external rename does not replace a title that is being typed', async () => {
  const { page } = await h.start();
  const n = await createNote(page, COMMON, 'Start');
  await reloadUi(page);
  await openFromTree(page, n);
  await renameActiveTab(page);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Typing in progress');
  await call(page, 'note', 'rename', { noteId: n, title: 'Elsewhere' });
  await expect(tabItem(page, 'Elsewhere')).toBeVisible();
  await expect(titleInput(page)).toHaveValue('Typing in progress');
  // Leaving the field flushes the typed title, which is the last writer.
  await page.getByRole('textbox', { name: 'Note text' }).click();
  await expect.poll(() => h.one<{ title: string }>('SELECT title FROM notes WHERE id = ?', n)?.title).toBe('Typing in progress');
  await expect(titleInput(page)).toHaveCount(0);
  await expect(activeTab(page)).toHaveText('Typing in progress');
  // Once the field is closed the tab follows later renames again.
  await call(page, 'note', 'rename', { noteId: n, title: 'Later' });
  await expect(activeTab(page)).toHaveText('Later');
});

test('the save indicator never reads Saved while an edit is pending (QA-P02-2)', async () => {
  const { page } = await h.start();
  const n = await createNote(page, COMMON, 'Status');
  await reloadUi(page);
  await openFromTree(page, n);
  const status = page.locator('.save-status');
  await expect(status).toHaveText('Saved');
  await page.getByRole('textbox', { name: 'Note text' }).click();
  await page.keyboard.type('x');
  await expect(status).not.toHaveText('Saved');
  await expect(status).toHaveText('Saved');
});

test('the title field is filled on its first render when a note opens (QA-P02-3)', async () => {
  const { page } = await h.start();
  const n = await createNote(page, COMMON, 'Orig');
  await reloadUi(page);
  await openFromTree(page, n);
  await renameActiveTab(page);
  await expect(titleInput(page)).toHaveValue('Orig');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Renamed quickly');
  await page.keyboard.press('Control+W');
  await expect.poll(() => h.one<{ title: string }>('SELECT title FROM notes WHERE id = ?', n)?.title).toBe('Renamed quickly');
});

test('restoring after the original parent was purged shows the relocation notice (QA-P02-4)', async () => {
  const { page } = await h.start();
  const a = await createProject(page, 'Alpha');
  const l1 = await createFolder(page, { projectId: a, parentId: null }, 'L1');
  const l2 = await createFolder(page, { projectId: a, parentId: l1 }, 'L2');
  const l3 = await createFolder(page, { projectId: a, parentId: l2 }, 'L3');
  await reloadUi(page);
  await trashFolder(page, l3);
  await trashFolder(page, l2);
  const list = await call(page, 'trash', 'list');
  const l2Batch = list.data!.items!.find((i) => i.id === l2)!.batchId;
  const purged = await call(page, 'trash', 'purge', { target: { kind: 'batch', batchId: l2Batch }, confirmed: true });
  expect(purged.ok).toBe(true);
  await reloadUi(page);
  await expandRows(page, ['trash']);
  const root = page.locator('[id^="tree-trash:"]:not([id="tree-trash:empty"])', { hasText: 'L3' });
  await chooseMenu(page, root, 'Restore');
  await expect(toasts(page).filter({ hasText: 'Restored to Alpha › L1 because its original location is in Trash or no longer exists' })).toBeVisible();
});
