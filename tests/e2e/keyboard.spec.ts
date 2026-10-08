import { expect, test } from '@playwright/test';
import { useApp } from './harness';
import { createFolder, createNote, createProject, reloadUi } from './seed';
import { activate, arrowToRow, expandRows, openFromTree, railGo, tabs, titleInput, treeByKey } from './ui';
import { editor } from './editor-ui';
import { stickyNoteIds, stickyPage } from './sticky-ui';

const h = useApp();

interface Loc {
  id: string;
  project_id: string | null;
  folder_id: string | null;
  sticky_enabled: number;
  color: string | null;
}
const newest = () => h.one<Loc>('SELECT id, project_id, folder_id, sticky_enabled, color FROM notes ORDER BY created_at DESC, rowid DESC LIMIT 1')!;
const count = () => h.all('SELECT id FROM notes').length;

async function seed(page: import('@playwright/test').Page) {
  const alpha = await createProject(page, 'Alpha');
  const l1 = await createFolder(page, { projectId: alpha, parentId: null }, 'L1');
  const l2 = await createFolder(page, { projectId: alpha, parentId: l1 }, 'L2');
  const l3 = await createFolder(page, { projectId: alpha, parentId: l2 }, 'L3');
  const n = await createNote(page, { projectId: alpha, folderId: l2 }, 'Note in L2');
  await reloadUi(page);
  await expandRows(page, [`project:${alpha}`, `folder:${l1}`, `folder:${l2}`]);
  return { alpha, l1, l2, l3, n };
}

/** A new sticky floats in its own window and opens no tab (D-069). */
async function expectNewStickyFloated(app: import('@playwright/test').ElectronApplication, page: import('@playwright/test').Page, expectedCount: number, floated: string[]): Promise<Loc> {
  await expect.poll(count).toBe(expectedCount);
  const created = newest();
  await stickyPage(app, created.id);
  await expect.poll(() => stickyNoteIds(app)).toEqual([...floated, created.id].sort());
  await expect(tabs(page).filter({ hasText: 'Untitled' })).toHaveCount(0);
  return created;
}

async function expectNewNoteActive(page: import('@playwright/test').Page, expectedCount: number): Promise<void> {
  await expect.poll(count).toBe(expectedCount);
  await expect(titleInput(page)).toBeFocused();
  await expect(tabs(page).filter({ hasText: 'Untitled' }).last()).toHaveAttribute('aria-selected', 'true');
}

test('ctrl+n', async () => {
  const { page } = await h.start();
  const s = await seed(page);

  // (a) Home with the Common filter.
  await railGo(page, 'Home');
  await activate(page.getByRole('radio', { name: 'Common', exact: true }));
  await page.keyboard.press('Control+N');
  await expectNewNoteActive(page, 2);
  expect(newest()).toMatchObject({ project_id: null, folder_id: null, sticky_enabled: 0 });

  // (b) An active note tab in L2 (the editor has focus, not the tree).
  await openFromTree(page, s.n);
  await editor(page).focus();
  await page.keyboard.press('Control+N');
  await expectNewNoteActive(page, 3);
  expect(newest()).toMatchObject({ project_id: s.alpha, folder_id: s.l2, sticky_enabled: 0 });

  // (c) The tree focused on folder L3.
  await arrowToRow(page, `folder:${s.l3}`);
  await page.keyboard.press('Control+N');
  await expectNewNoteActive(page, 4);
  expect(newest()).toMatchObject({ project_id: s.alpha, folder_id: s.l3 });

  // (d) The Settings tab.
  await railGo(page, 'Settings');
  await page.keyboard.press('Control+N');
  await expectNewNoteActive(page, 5);
  expect(newest()).toMatchObject({ project_id: null, folder_id: null });
});

test('ctrl+shift+n', async () => {
  const { app, page } = await h.start();
  const s = await seed(page);
  const tabsBefore = await tabs(page).count();

  // (a) Home with the Common filter.
  await railGo(page, 'Home');
  await activate(page.getByRole('radio', { name: 'Common', exact: true }));
  await page.keyboard.press('Control+Shift+N');
  const a = await expectNewStickyFloated(app, page, 2, []);
  expect(a).toMatchObject({ project_id: null, folder_id: null, sticky_enabled: 1, color: 'yellow' });
  await expect(treeByKey(page, `note:${a.id}`).locator('svg.lucide-sticky-note')).toBeVisible();

  // (c) The tree focused on folder L3.
  await arrowToRow(page, `folder:${s.l3}`);
  await page.keyboard.press('Control+Shift+N');
  const c = await expectNewStickyFloated(app, page, 3, [a.id]);
  expect(c).toMatchObject({ project_id: s.alpha, folder_id: s.l3, sticky_enabled: 1, color: 'yellow' });
  await expect(treeByKey(page, `note:${c.id}`).locator('svg.lucide-sticky-note')).toBeVisible();
  expect(await tabs(page).count()).toBe(tabsBefore);
});
