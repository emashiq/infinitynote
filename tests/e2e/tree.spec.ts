import { expect, test, type Page } from '@playwright/test';
import { useApp } from './harness';
import { createFolder, createNote, createProject, reloadUi, trashFolder, trashNote } from './seed';
import {
  activate,
  chooseMenu,
  confirmDialog,
  dialogByName,
  expandRows,
  menuItem,
  openContextMenu,
  railGo,
  submitNameDialog,
  tabItem,
  titleInput,
  toasts,
  treeByKey,
  treeItem,
} from './ui';
import { stickyNoteIds, stickyPage } from './sticky-ui';

const h = useApp();

interface FolderRow {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  name: string;
  deleted_at: number | null;
  favorite: number;
}
interface NoteRowDb {
  id: string;
  project_id: string | null;
  folder_id: string | null;
  sticky_enabled: number;
  color: string | null;
  deleted_at: number | null;
  favorite: number;
  pinned_at: number | null;
}
const folderByName = (name: string) => h.one<FolderRow>('SELECT id, project_id, parent_id, name, deleted_at, favorite FROM folders WHERE name = ?', name)!;
const noteRow = (id: string) => h.one<NoteRowDb>('SELECT id, project_id, folder_id, sticky_enabled, color, deleted_at, favorite, pinned_at FROM notes WHERE id = ?', id)!;
const level = (page: Page, label: string) => treeItem(page, label).getAttribute('aria-level');

async function newFolderIn(page: Page, parentLabel: string, name: string): Promise<void> {
  await chooseMenu(page, treeItem(page, parentLabel), 'New folder');
  await submitNameDialog(page, 'New folder', name);
  await expect(treeItem(page, name)).toBeVisible();
}

test('Common protected', async () => {
  const { app, page } = await h.start();
  const common = treeByKey(page, 'common');
  await common.focus();
  await expect(common).toHaveAttribute('aria-level', '1');
  expect(await page.getByRole('treeitem').first().getAttribute('id')).toBe('tree-common');

  await common.press('F2');
  await expect(toasts(page).filter({ hasText: 'Common cannot be renamed' })).toBeVisible();
  await expect(page.locator('.rename-input')).toHaveCount(0);

  await common.press('Delete');
  await expect(toasts(page).filter({ hasText: 'Common cannot be moved to Trash' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await openContextMenu(common);
  await expect(page.getByRole('menu')).toBeVisible();
  // The context menu's items (the title bar's menubar has File, View and Help items of its own, D-097).
  const names = await page.getByRole('menu').getByRole('menuitem').allTextContents();
  expect(names).toEqual(['New note', 'New sticky', 'New folder']);
  for (const banned of ['Rename', 'Move to…', 'Move to Trash']) await expect(menuItem(page, banned)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(common).toBeFocused();

  // Notes, stickies and folders can be created at the Common root.
  await chooseMenu(page, common, 'New note');
  await expect(titleInput(page)).toBeFocused();
  await expect.poll(() => h.all('SELECT id FROM notes WHERE project_id IS NULL AND folder_id IS NULL AND sticky_enabled = 0').length).toBe(1);
  await chooseMenu(page, treeByKey(page, 'common'), 'New sticky');
  await expect.poll(() => h.all('SELECT id FROM notes WHERE project_id IS NULL AND folder_id IS NULL AND sticky_enabled = 1').length).toBe(1);
  await expect.poll(async () => (await stickyNoteIds(app)).length).toBe(1);
  await newFolderIn(page, 'Common', 'Inbox');
  expect(h.all('SELECT name FROM projects')).toHaveLength(0);
});

test('project CRUD', async () => {
  const { page } = await h.start();
  // Alpha from the Home tile, Beta from the tree button.
  await activate(page.getByRole('button', { name: 'New project', exact: true }).and(page.locator('.tile')));
  await submitNameDialog(page, 'New project', 'Alpha');
  await activate(page.getByRole('navigation', { name: 'Notes' }).getByRole('button', { name: 'New project' }));
  await submitNameDialog(page, 'New project', 'Beta');
  const projects = page.getByRole('treeitem').filter({ has: page.locator('.tree-label') });
  await expect(treeItem(page, 'Alpha')).toBeVisible();
  await expect(treeItem(page, 'Beta')).toBeVisible();
  const labels = await projects.locator('.tree-label').allTextContents();
  expect(labels.indexOf('Alpha')).toBeLessThan(labels.indexOf('Beta'));
  expect(labels.indexOf('Projects')).toBeLessThan(labels.indexOf('Alpha'));

  const alpha = treeItem(page, 'Alpha');
  await alpha.focus();
  await alpha.press('F2');
  const input = page.getByRole('textbox', { name: 'Rename' });
  await input.fill('Alpha 2');
  await input.press('Enter');
  await expect(treeItem(page, 'Alpha 2')).toBeVisible();
  await expect.poll(() => h.all<{ name: string }>('SELECT name FROM projects ORDER BY name').map((r) => r.name)).toEqual(['Alpha 2', 'Beta']);

  await h.restart();
  await expect(treeItem(h.page, 'Alpha 2')).toBeVisible();
  const beta = treeItem(h.page, 'Beta');
  await beta.focus();
  await beta.press('Delete');
  await expect(dialogByName(h.page, 'Move to Trash?')).toContainText('Beta');
  await confirmDialog(h.page, 'Move to Trash?', 'Move to Trash');
  await expect(treeItem(h.page, 'Beta')).toHaveCount(0);
  await expandRows(h.page, ['trash']);
  await expect(h.page.locator('[id^="tree-trash:"]:not([id="tree-trash:empty"])')).toHaveCount(1);
  await expect(h.page.locator('[id^="tree-trash:"]:not([id="tree-trash:empty"]) .tree-label')).toHaveText('Beta');
  expect(h.one<{ deleted_at: number | null }>("SELECT deleted_at FROM projects WHERE name = 'Beta'")?.deleted_at).not.toBeNull();
});

test('nested folders', async () => {
  const { page } = await h.start();
  const alphaId = await createProject(page, 'Alpha');
  await reloadUi(page);
  await newFolderIn(page, 'Alpha', 'L1');
  await newFolderIn(page, 'L1', 'L2');
  await newFolderIn(page, 'L2', 'L3');
  expect(await level(page, 'Alpha')).toBe('2');
  expect(await level(page, 'L1')).toBe('3');
  expect(await level(page, 'L2')).toBe('4');
  expect(await level(page, 'L3')).toBe('5');
  await newFolderIn(page, 'Common', 'C1');
  await newFolderIn(page, 'C1', 'C2');
  expect(await level(page, 'C1')).toBe('2');
  expect(await level(page, 'C2')).toBe('3');

  const l2 = treeItem(page, 'L2');
  await l2.focus();
  await l2.press('F2');
  const input = page.getByRole('textbox', { name: 'Rename' });
  await input.fill('L2 renamed');
  await input.press('Enter');
  await expect(treeItem(page, 'L2 renamed')).toBeVisible();

  const l3 = treeItem(page, 'L3');
  await l3.focus();
  await l3.press('Delete');
  await confirmDialog(page, 'Move to Trash?', 'Move to Trash');
  await expect(treeItem(page, 'L3')).toHaveCount(0);

  expect(folderByName('L1')).toMatchObject({ project_id: alphaId, parent_id: null });
  expect(folderByName('L2 renamed').parent_id).toBe(folderByName('L1').id);
  expect(folderByName('L3').deleted_at).not.toBeNull();
  expect(folderByName('C2')).toMatchObject({ project_id: null, parent_id: folderByName('C1').id });
  await h.restart();
  await expect(treeItem(h.page, 'Alpha')).toBeVisible();
  expect(h.all('SELECT name FROM folders WHERE deleted_at IS NULL')).toHaveLength(4);
});

test('create note in folder', async () => {
  const { page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const l1 = await createFolder(page, { projectId: alpha, parentId: null }, 'L1');
  const l2 = await createFolder(page, { projectId: alpha, parentId: l1 }, 'L2');
  const l3 = await createFolder(page, { projectId: alpha, parentId: l2 }, 'L3');
  await reloadUi(page);
  await expandRows(page, [`project:${alpha}`, `folder:${l1}`, `folder:${l2}`]);

  await chooseMenu(page, treeByKey(page, `folder:${l3}`), 'New note');
  await expect(titleInput(page)).toBeFocused();
  await expect.poll(() => h.all('SELECT id FROM notes').length).toBe(1);
  const inL3 = h.one<NoteRowDb>('SELECT id, project_id, folder_id, sticky_enabled, color, deleted_at, favorite, pinned_at FROM notes')!;
  expect(inL3).toMatchObject({ folder_id: l3, project_id: alpha, sticky_enabled: 0 });
  await expect(treeByKey(page, `note:${inL3.id}`)).toBeVisible();

  // Ctrl+N with the tree focused on L2 (reached with arrow keys so the selection follows).
  const l2Row = treeByKey(page, `folder:${l2}`);
  await l2Row.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(l2Row).toBeFocused();
  await page.keyboard.press('Control+N');
  await expect(titleInput(page)).toBeFocused();
  await expect.poll(() => h.all('SELECT id FROM notes').length).toBe(2);
  const inL2 = h.one<NoteRowDb>('SELECT id, project_id, folder_id, sticky_enabled, color, deleted_at, favorite, pinned_at FROM notes WHERE folder_id = ?', l2)!;
  expect(inL2).toMatchObject({ project_id: alpha, folder_id: l2 });
  await expect(treeByKey(page, `note:${inL2.id}`)).toHaveAttribute('aria-level', '5');

  await chooseMenu(page, treeByKey(page, 'common'), 'New note');
  await expect.poll(() => h.all('SELECT id FROM notes').length).toBe(3);
  expect(h.one('SELECT id FROM notes WHERE project_id IS NULL AND folder_id IS NULL')).toBeTruthy();
  await expect(tabItem(page, 'Untitled').first()).toBeVisible();
});

test('sticky in folder', async () => {
  const { app, page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const l1 = await createFolder(page, { projectId: alpha, parentId: null }, 'L1');
  await reloadUi(page);
  await expandRows(page, [`project:${alpha}`]);
  await chooseMenu(page, treeByKey(page, `folder:${l1}`), 'New sticky');
  await expect.poll(() => h.all('SELECT id FROM notes WHERE sticky_enabled = 1').length).toBe(1);
  const row = h.one<NoteRowDb>('SELECT id, project_id, folder_id, sticky_enabled, color, deleted_at, favorite, pinned_at FROM notes')!;
  expect(row).toMatchObject({ sticky_enabled: 1, color: 'yellow', folder_id: l1 });
  const treeRow = treeByKey(page, `note:${row.id}`);
  await expect(treeRow.locator('svg.lucide-sticky-note')).toBeVisible();
  await expect(treeRow.locator('.dot-yellow')).toBeVisible();
  // The new sticky floats in its own window and opens no tab (D-069).
  await stickyPage(app, row.id);
  await expect.poll(() => stickyNoteIds(app)).toEqual([row.id]);
  await expect(page.locator(`[id="tab-note:${row.id}"]`)).toHaveCount(0);

  await railGo(page, 'Stickies');
  const stickyRow = page.locator('.sticky-row');
  await expect(stickyRow).toHaveCount(1);
  await expect(stickyRow.locator('.sticky-path')).toHaveText('Alpha › L1');
  await expect(stickyRow.getByRole('button', { name: /^Open/ })).toBeVisible();
  await activate(stickyRow.getByRole('button', { name: /^Open/ }));
  await expect(page.getByRole('textbox', { name: 'Note text', exact: true })).toBeVisible();
});

async function moveVia(page: Page, row: ReturnType<typeof treeByKey>, filter: string): Promise<void> {
  await chooseMenu(page, row, 'Move to…');
  const dialog = dialogByName(page, /^Move/);
  await dialog.waitFor({ state: 'visible' });
  const input = dialog.getByRole('combobox', { name: 'Filter locations' });
  await input.fill(filter);
  await input.press('Enter');
}

test('move persists after restart', async () => {
  const { page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const beta = await createProject(page, 'Beta');
  const l1 = await createFolder(page, { projectId: alpha, parentId: null }, 'L1');
  const l2 = await createFolder(page, { projectId: alpha, parentId: l1 }, 'L2');
  const n = await createNote(page, { projectId: alpha, folderId: l2 }, 'Deep note');
  const t = await createNote(page, { projectId: alpha, folderId: l1 }, 'Trashed deep');
  await trashNote(page, t);
  await reloadUi(page);
  await expandRows(page, [`project:${alpha}`]);

  await moveVia(page, treeByKey(page, `folder:${l1}`), 'Beta');
  await expect(dialogByName(page, /^Move/)).toHaveCount(0);
  await expandRows(page, [`project:${beta}`]);
  await expect(treeByKey(page, `folder:${l1}`)).toHaveAttribute('aria-level', '3');
  await expect(treeByKey(page, `folder:${l1}`)).toBeFocused();

  await h.restart();
  await expandRows(h.page, [`project:${beta}`, `folder:${l1}`, `folder:${l2}`]);
  await expect(treeByKey(h.page, `note:${n}`)).toBeVisible();
  const rows = h.all<{ id: string; project_id: string | null }>('SELECT id, project_id FROM folders');
  expect(rows.every((r) => r.project_id === beta)).toBe(true);
  expect(noteRow(n).project_id).toBe(beta);
  expect(noteRow(t).project_id).toBe(beta);
  expect(folderByName('L2').parent_id).toBe(l1);
  expect(folderByName('L1').parent_id).toBeNull();
});

test('cycle rejected', async () => {
  const { page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const l1 = await createFolder(page, { projectId: alpha, parentId: null }, 'L1');
  await createFolder(page, { projectId: alpha, parentId: l1 }, 'L2');
  await reloadUi(page);
  await expandRows(page, [`project:${alpha}`]);
  const row = treeByKey(page, `folder:${l1}`);
  await chooseMenu(page, row, 'Move to…');
  const dialog = dialogByName(page, /^Move/);
  const input = dialog.getByRole('combobox', { name: 'Filter locations' });
  await input.fill('Alpha › L1 › L2');
  await input.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('A folder cannot be moved into itself or one of its subfolders.');
  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  await cancel.focus();
  await cancel.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(row).toBeFocused();
  expect(folderByName('L1')).toMatchObject({ project_id: alpha, parent_id: null });
  expect(folderByName('L2').parent_id).toBe(l1);
});

test('trash and restore', async () => {
  const { page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const l1 = await createFolder(page, { projectId: alpha, parentId: null }, 'L1');
  const l2 = await createFolder(page, { projectId: alpha, parentId: l1 }, 'L2');
  const child = await createNote(page, { projectId: alpha, folderId: l2 }, 'Child note');
  const f = await createFolder(page, { projectId: alpha, parentId: l1 }, 'F');
  const nn = await createNote(page, { projectId: alpha, folderId: f }, 'N note');
  await reloadUi(page);
  await expandRows(page, [`project:${alpha}`, `folder:${l1}`, 'trash']);
  await expect(treeByKey(page, 'trash:empty')).toBeVisible();

  // Folder: Delete then confirm; Trash lists exactly one root named L2; Restore returns it under L1.
  const l2Row = treeByKey(page, `folder:${l2}`);
  await l2Row.focus();
  await l2Row.press('Delete');
  await confirmDialog(page, 'Move to Trash?', 'Move to Trash');
  await expect(l2Row).toHaveCount(0);
  await expect(treeByKey(page, `note:${child}`)).toHaveCount(0);
  const trashRoots = page.locator('[id^="tree-trash:"]:not([id="tree-trash:empty"])');
  await expect(trashRoots).toHaveCount(1);
  await expect(trashRoots.locator('.tree-label')).toHaveText('L2');
  await chooseMenu(page, trashRoots.first(), 'Restore');
  await expect(treeByKey(page, `folder:${l2}`)).toBeVisible();
  await expect(trashRoots).toHaveCount(0);
  expect(folderByName('L2')).toMatchObject({ parent_id: l1, deleted_at: null });
  expect(noteRow(child).deleted_at).toBeNull();

  // Note N is trashed first, then its folder; restoring N lands in the nearest live ancestor with a notice.
  await expandRows(page, [`folder:${f}`]);
  const nRow = treeByKey(page, `note:${nn}`);
  await nRow.focus();
  await nRow.press('Delete');
  await confirmDialog(page, 'Move to Trash?', 'Move to Trash');
  const fRow = treeByKey(page, `folder:${f}`);
  await fRow.focus();
  await fRow.press('Delete');
  await confirmDialog(page, 'Move to Trash?', 'Move to Trash');
  await expect(trashRoots).toHaveCount(2);
  const noteRoot = page.locator('[id^="tree-trash:"]:not([id="tree-trash:empty"])', { hasText: 'N note' });
  await chooseMenu(page, noteRoot, 'Restore');
  await expect(toasts(page).filter({ hasText: 'Restored to Alpha › L1 because its original location is in Trash or no longer exists' })).toBeVisible();
  await expect(treeByKey(page, `note:${nn}`)).toBeVisible();
  expect(noteRow(nn)).toMatchObject({ folder_id: l1, deleted_at: null });

  // Delete forever names the item count and removes the rows.
  const remaining = page.locator('[id^="tree-trash:"]:not([id="tree-trash:empty"])');
  await expect(remaining).toHaveCount(1);
  await chooseMenu(page, remaining.first(), 'Delete forever');
  const purge = dialogByName(page, 'Delete forever?');
  await expect(purge).toContainText('1 item');
  await confirmDialog(page, 'Delete forever?', 'Delete forever');
  await expect(remaining).toHaveCount(0);
  expect(h.all('SELECT id FROM folders WHERE name = ?', 'F')).toHaveLength(0);

  // Empty trash removes everything.
  await trashNote(page, child);
  await trashFolder(page, l2);
  await expect(page.locator('[id^="tree-trash:"]:not([id="tree-trash:empty"])')).toHaveCount(2);
  await chooseMenu(page, treeByKey(page, 'trash'), 'Empty trash');
  await expect(dialogByName(page, 'Empty trash?')).toContainText('2 items');
  await confirmDialog(page, 'Empty trash?', 'Empty trash');
  await expect(page.getByRole('treeitem', { name: 'Trash is empty' })).toBeVisible();
  expect(h.all('SELECT id FROM notes WHERE deleted_at IS NOT NULL')).toHaveLength(0);
  expect(h.all('SELECT id FROM folders WHERE deleted_at IS NOT NULL')).toHaveLength(0);
});

test('favorites', async () => {
  const { page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const l1 = await createFolder(page, { projectId: alpha, parentId: null }, 'L1');
  const n = await createNote(page, { projectId: alpha, folderId: l1 }, 'Fav note');
  await reloadUi(page);
  await expandRows(page, [`project:${alpha}`, `folder:${l1}`]);

  await chooseMenu(page, treeByKey(page, `note:${n}`), 'Pin to Home');
  await expect.poll(() => noteRow(n).pinned_at).not.toBeNull();
  await chooseMenu(page, treeByKey(page, `note:${n}`), 'Add to favorites');
  await chooseMenu(page, treeByKey(page, `folder:${l1}`), 'Add to favorites');
  await chooseMenu(page, treeByKey(page, `project:${alpha}`), 'Add to favorites');
  await expect.poll(() => noteRow(n).favorite).toBe(1);

  await h.restart();
  await expandRows(h.page, ['favorites']);
  for (const key of [`fav:project:${alpha}`, `fav:folder:${l1}`, `fav:note:${n}`]) await expect(treeByKey(h.page, key)).toBeVisible();
  expect(h.one<{ favorite: number }>('SELECT favorite FROM folders WHERE id = ?', l1)?.favorite).toBe(1);
  expect(h.one<{ favorite: number }>('SELECT favorite FROM projects WHERE id = ?', alpha)?.favorite).toBe(1);
  expect(noteRow(n).pinned_at).not.toBeNull();

  await chooseMenu(h.page, treeByKey(h.page, `fav:folder:${l1}`), 'Remove from favorites');
  await expect(treeByKey(h.page, `fav:folder:${l1}`)).toHaveCount(0);
  expect(h.one<{ favorite: number }>('SELECT favorite FROM folders WHERE id = ?', l1)?.favorite).toBe(0);

  // The favorite entry opens the note.
  const fav = treeByKey(h.page, `fav:note:${n}`);
  await fav.focus();
  await fav.press('Enter');
  await expect(tabItem(h.page, 'Fav note')).toHaveAttribute('aria-selected', 'true');
});
