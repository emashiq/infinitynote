import { expect, test, type Page } from '@playwright/test';
import { setContentSize } from './fixtures';
import { useApp } from './harness';
import { COMMON, createFolder, createNote, createProject, reloadUi } from './seed';
import { activeTabLabel, dialogByName, openContextMenu, openFromTree, railGo, tabLabels, tabs, treeByKey, treeItem } from './ui';

const h = useApp();
const COMMON_PARENT = { projectId: null, parentId: null };

/** True when the focus is inside the tree or a dialog (never `body`). */
async function focusIsContained(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement;
    return !!el && el !== document.body && !!el.closest('[role="tree"], dialog');
  });
}

test('tree', async () => {
  const { page } = await h.start();
  const kf = await createFolder(page, COMMON_PARENT, 'KF');
  const k1 = await createNote(page, COMMON, 'K1');
  const k2 = await createNote(page, COMMON, 'K2');
  await createNote(page, { projectId: null, folderId: kf }, 'Inner');
  await reloadUi(page);

  // Tab from the document start until the tree gets focus.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let inTree = false;
  for (let i = 0; i < 30 && !inTree; i += 1) {
    await page.keyboard.press('Tab');
    inTree = await page.evaluate(() => !!document.activeElement?.closest('[role="tree"]'));
  }
  expect(inTree).toBe(true);
  const focusedId = () => page.evaluate(() => document.activeElement?.id ?? '');
  expect(await focusedId()).toBe('tree-common');

  // Arrow, Home and End.
  await page.keyboard.press('ArrowDown');
  expect(await focusedId()).toBe(`tree-folder:${kf}`);
  await page.keyboard.press('ArrowUp');
  expect(await focusedId()).toBe('tree-common');
  await page.keyboard.press('End');
  expect(await focusedId()).toBe('tree-trash');
  await page.keyboard.press('Home');
  expect(await focusedId()).toBe('tree-common');

  // Right and Left toggle aria-expanded on the folder and move into the child / back to the parent.
  await page.keyboard.press('ArrowDown');
  const kfRow = treeByKey(page, `folder:${kf}`);
  await expect(kfRow).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(kfRow).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-level'))).toBe('3');
  await expect(page.locator(`[id="tree-folder:${kf}"]`)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowLeft');
  expect(await focusedId()).toBe(`tree-folder:${kf}`);
  await page.keyboard.press('ArrowLeft');
  await expect(kfRow).toHaveAttribute('aria-expanded', 'false');
  expect(await focusedId()).toBe(`tree-folder:${kf}`);
  await expect(kfRow).toHaveAttribute('aria-selected', 'true');

  // Enter opens a note.
  await page.keyboard.press('ArrowDown');
  expect(await focusedId()).toBe(`tree-note:${k1}`);
  await page.keyboard.press('Enter');
  await expect(tabs(page).filter({ hasText: 'K1' })).toHaveAttribute('aria-selected', 'true');
  expect(await focusIsContained(page)).toBe(true);

  // F2, type, Enter renames and keeps the focus on the row.
  await page.keyboard.press('F2');
  const rename = page.getByRole('textbox', { name: 'Rename' });
  await expect(rename).toBeFocused();
  await rename.fill('Renamed');
  await rename.press('Enter');
  await expect(treeItem(page, 'Renamed')).toBeFocused();
  await expect.poll(() => h.one<{ title: string }>('SELECT title FROM notes WHERE id = ?', k1)?.title).toBe('Renamed');

  // Delete then Escape cancels with the focus back on the row; Delete then Enter trashes.
  await page.keyboard.press('ArrowUp'); // the renamed note now sorts after K2
  expect(await focusedId()).toBe(`tree-note:${k2}`);
  await page.keyboard.press('Delete');
  const confirm = dialogByName(page, 'Move to Trash?');
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  expect(await focusedId()).toBe(`tree-note:${k2}`);
  await page.keyboard.press('Delete');
  await expect(confirm).toBeVisible();
  expect(await focusIsContained(page)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(confirm).toHaveCount(0);
  await expect(treeByKey(page, `note:${k2}`)).toHaveCount(0);
  await expect.poll(() => h.one<{ deleted_at: number | null }>('SELECT deleted_at FROM notes WHERE id = ?', k2)?.deleted_at).not.toBeNull();
  expect(await focusIsContained(page)).toBe(true);

  // Shift+F10, Down, Down, Enter chooses "New folder"; Enter accepts the default name.
  await treeByKey(page, `folder:${kf}`).focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const dialog = dialogByName(page, 'New folder');
  await expect(dialog).toBeVisible();
  expect(await focusIsContained(page)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => h.all('SELECT id FROM folders WHERE name = ? AND parent_id = ?', 'New folder', kf).length).toBe(1);
  await expect(treeItem(page, 'New folder')).toBeVisible();
  expect(await focusIsContained(page)).toBe(true);
});

test('dialogs return focus', async () => {
  const { page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const l1 = await createFolder(page, { projectId: alpha, parentId: null }, 'L1');
  await createFolder(page, { projectId: alpha, parentId: null }, 'L2');
  await reloadUi(page);
  const folder = treeByKey(page, `folder:${l1}`);
  await page.locator(`[id="tree-project:${alpha}"]`).focus();
  await page.keyboard.press('ArrowRight');
  await expect(folder).toBeVisible();

  // New project dialog returns to the button that opened it.
  const newProject = page.getByRole('navigation', { name: 'Notes' }).getByRole('button', { name: 'New project' });
  await newProject.focus();
  await page.keyboard.press('Enter');
  await expect(dialogByName(page, 'New project')).toBeVisible();
  await expect(dialogByName(page, 'New project').getByLabel('Name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialogByName(page, 'New project')).toHaveCount(0);
  await expect(newProject).toBeFocused();

  // Context menu returns to its row.
  await openContextMenu(folder);
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(folder).toBeFocused();

  // Move dialog returns to the row.
  await openContextMenu(folder);
  await page.getByRole('menuitem', { name: 'Move to…' }).focus();
  await page.keyboard.press('Enter');
  const move = dialogByName(page, /^Move/);
  await expect(move).toBeVisible();
  await expect(move.getByRole('combobox', { name: 'Filter locations' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(move).toHaveCount(0);
  await expect(folder).toBeFocused();

  // Confirm dialog returns to the row.
  await folder.press('Delete');
  await expect(dialogByName(page, 'Move to Trash?')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialogByName(page, 'Move to Trash?')).toHaveCount(0);
  await expect(folder).toBeFocused();

  // Palette returns to the previous element; the All tabs menu returns to its button.
  await page.keyboard.press('Control+K');
  await expect(dialogByName(page, 'Command palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(folder).toBeFocused();
  const allTabs = page.getByRole('button', { name: 'All tabs' });
  await allTabs.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'All tabs' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(allTabs).toBeFocused();
});

test('tabs keyboard-only', async () => {
  const { page } = await h.start();
  const a = await createNote(page, COMMON, 'Key one');
  const b = await createNote(page, COMMON, 'Key two');
  await reloadUi(page);
  // Open both from the tree with Enter.
  for (const id of [a, b]) {
    const row = treeByKey(page, `note:${id}`);
    await row.focus();
    await page.keyboard.press('Enter');
  }
  expect(await tabLabels(page)).toEqual(['Home', 'Key one', 'Key two']);
  expect(await activeTabLabel(page)).toBe('Key two');
  await page.keyboard.press('Control+Shift+Tab');
  await expect.poll(() => activeTabLabel(page)).toBe('Key one');
  await page.keyboard.press('Control+Tab');
  await expect.poll(() => activeTabLabel(page)).toBe('Key two');
  await page.keyboard.press('Control+W');
  await expect.poll(() => tabLabels(page)).toEqual(['Home', 'Key one']);
  await page.keyboard.press('Control+W');
  await expect.poll(() => tabLabels(page)).toEqual(['Home']);
  expect(await activeTabLabel(page)).toBe('Home');
});

test('accessibility structure on every view', async () => {
  const { app, page } = await h.start();
  await setContentSize(app, page, 1280, 800);
  await createNote(page, COMMON, 'A11y note');
  await reloadUi(page);
  const audit = () =>
    page.evaluate(() => {
      const accessibleName = (el: Element): string => {
        const label = el.getAttribute('aria-label');
        if (label) return label.trim();
        const by = el.getAttribute('aria-labelledby');
        if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
        const id = el.getAttribute('id');
        const forLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : null;
        if (forLabel) return forLabel.trim();
        const wrap = el.closest('label')?.textContent;
        if (wrap) return wrap.trim();
        return (el.textContent ?? '').trim();
      };
      const problems: string[] = [];
      if (document.querySelectorAll('h1').length !== 1) problems.push('h1 count');
      for (const sel of ['header[role="banner"]', 'nav[aria-label="Primary"]', 'nav[aria-label="Notes"]', 'main', 'aside[aria-label="Details"]']) {
        if (document.querySelectorAll(sel).length !== 1) problems.push(`landmark ${sel}`);
      }
      if (document.querySelectorAll('[role="tabpanel"] h2').length < 1) problems.push('view h2');
      for (const b of document.querySelectorAll('button, [role="switch"], [role="tab"], [role="treeitem"]')) {
        if (accessibleName(b) === '') problems.push(`unnamed ${b.tagName}.${b.className}`);
      }
      for (const c of document.querySelectorAll('input, select, textarea')) {
        if (accessibleName(c) === '') problems.push(`unlabelled ${c.tagName}.${c.className}`);
      }
      for (const t of document.querySelectorAll('[tabindex]')) {
        if (Number(t.getAttribute('tabindex')) > 0) problems.push('positive tabindex');
      }
      return problems;
    });
  expect(await audit()).toEqual([]);
  for (const name of ['Stickies', 'Reminders', 'Settings'] as const) {
    await railGo(page, name);
    expect(await audit(), name).toEqual([]);
  }
  await openFromTree(page, (h.one<{ id: string }>('SELECT id FROM notes')!).id);
  expect(await audit()).toEqual([]);
  await page.keyboard.press('Control+K');
  expect(await audit()).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Notes' }).getByRole('button', { name: 'New project' }).focus();
  await page.keyboard.press('Enter');
  expect(await audit()).toEqual([]);
});
