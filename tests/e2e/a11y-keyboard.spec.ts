import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { setContentSize } from './fixtures';
import { useApp } from './harness';
import { COMMON, createFolder, createNote, createProject, reloadUi } from './seed';
import { editor } from './editor-ui';
import { queueSave, tempFolder } from './portability-ui';
import { activeTab, activeTabLabel, dialogByName, openContextMenu, openFromTree, railGo, tabLabels, tabs, titleInput, toasts, treeByKey, treeItem } from './ui';

const h = useApp();
const COMMON_PARENT = { projectId: null, parentId: null };

/** Presses ArrowDown in an open menu until the item has focus (at most 15 steps). */
async function arrowDownTo(page: Page, item: Locator): Promise<void> {
  for (let i = 0; i < 15 && !(await item.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('ArrowDown');
  await expect(item).toBeFocused();
}

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
  await expect.poll(() => tabLabels(page)).toEqual(['Home', 'Key one', 'Key two']);
  await expect.poll(() => activeTabLabel(page)).toBe('Key two');
  await page.keyboard.press('Control+Shift+Tab');
  await expect.poll(() => activeTabLabel(page)).toBe('Key one');
  await page.keyboard.press('Control+Tab');
  await expect.poll(() => activeTabLabel(page)).toBe('Key two');
  await page.keyboard.press('Control+W');
  await expect.poll(() => tabLabels(page)).toEqual(['Home', 'Key one']);
  await page.keyboard.press('Control+W');
  await expect.poll(() => tabLabels(page)).toEqual(['Home']);
  await expect.poll(() => activeTabLabel(page)).toBe('Home');
});

test('accessibility structure on every view', async () => {
  const { app, page } = await h.start();
  await setContentSize(app, page, 1280, 800);
  await createNote(page, COMMON, 'A11y note');
  await reloadUi(page);
  // The Details panel starts closed (D-102); the audit covers it open.
  await page.keyboard.press('Control+Shift+Backslash');
  await expect(page.getByRole('complementary', { name: 'Details' })).toBeVisible();
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

test('Enter right after typing a new title moves the very next keys into the text (A08-F1, INF-A11Y-01)', async () => {
  const { page } = await h.start();
  for (const n of [1, 2, 3]) {
    await page.keyboard.press('Control+N');
    await expect(titleInput(page)).toBeFocused();
    await page.keyboard.type(`Quick ${n}`);
    await page.keyboard.press('Enter');
    await page.keyboard.type(`Body ${n}`);
    await expect(editor(page)).toBeFocused();
    await expect(activeTab(page)).toHaveText(`Quick ${n}`);
  }
  await expect
    .poll(() => h.all('SELECT title, plain_text FROM notes ORDER BY title'))
    .toEqual([1, 2, 3].map((n) => ({ title: `Quick ${n}`, plain_text: `Body ${n}` })));
});

test('keyboard-only primary flows: write, search, menus, theme, help and backup without the mouse (INF-A11Y-01, INF-A11Y-02)', async () => {
  const { app, page } = await h.start();
  const files = tempFolder();
  try {
    // A note: Ctrl+N, the title, Enter into the text.
    await page.keyboard.press('Control+N');
    await expect(titleInput(page)).toBeFocused();
    // No wait between the title, Enter and the text (A08-F1).
    await page.keyboard.type('Keyboard note');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Typed without a mouse');
    await expect(editor(page)).toBeFocused();
    await expect.poll(() => h.all('SELECT title, plain_text FROM notes')).toEqual([{ title: 'Keyboard note', plain_text: 'Typed without a mouse' }]);

    // The palette opens Settings.
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Open Settings');
    await page.keyboard.press('Enter');
    await expect.poll(() => activeTabLabel(page)).toBe('Settings');

    // Alt focuses the menu bar; arrows reach View → Dark theme; Escape returns to the menu button.
    await page.keyboard.press('Alt');
    const menubar = page.getByRole('menubar', { name: 'Application menu' });
    await expect(menubar.getByRole('menuitem', { name: 'File', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(menubar.getByRole('menuitem', { name: 'View', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menu', { name: 'View' })).toBeVisible();
    await arrowDownTo(page, page.getByRole('menuitemradio', { name: 'Dark theme' }));
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await page.keyboard.press('Alt');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menu', { name: 'File' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'File' })).toHaveCount(0);
    await expect(menubar.getByRole('menuitem', { name: 'File', exact: true })).toBeFocused();

    // Keyboard help and back.
    await page.keyboard.press('Control+/');
    await expect(dialogByName(page, 'Keyboard shortcuts')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menubar.getByRole('menuitem', { name: 'File', exact: true })).toBeFocused();

    // File → Back up now…, reached with the arrow keys.
    await queueSave(app, path.join(files, 'keys.infinitybackup'));
    await page.keyboard.press('ArrowDown');
    await arrowDownTo(page, page.getByRole('menu', { name: 'File' }).getByRole('menuitem', { name: 'Back up now…' }));
    await page.keyboard.press('Enter');
    await expect(toasts(page).filter({ hasText: 'Backup saved: keys.infinitybackup' })).toBeVisible();
    expect(fs.existsSync(path.join(files, 'keys.infinitybackup'))).toBe(true);
  } finally {
    fs.rmSync(files, { recursive: true, force: true });
  }
});

test('getByRole coverage: Settings sections are named regions and the new controls have names and roles (INF-A11Y-03)', async () => {
  const { app, page } = await h.start();
  await setContentSize(app, page, 1280, 800);
  await railGo(page, 'Settings');
  for (const name of ['General', 'Appearance', 'Notes and attachments', 'Reminders', 'Windows and tray', 'Backup', 'Keyboard', 'About']) {
    const region = page.getByRole('region', { name, exact: true });
    await expect(region, name).toBeVisible();
    await expect(region.getByRole('heading', { level: 3, name, exact: true }), name).toBeVisible();
  }
  for (const name of ['Show data folder', 'Back up now…', 'Restore from backup…', 'Export all notes…', 'Import notes…', 'Choose folder…', 'Show keyboard shortcuts']) {
    await expect(page.getByRole('button', { name, exact: true }), name).toBeVisible();
  }
  await expect(page.getByRole('switch', { name: 'Back up automatically' })).toBeVisible();
  for (const name of ['Largest image', 'Largest file', 'Keep automatic versions for', 'Most automatic versions per note']) {
    await expect(page.getByRole('spinbutton', { name }), name).toBeVisible();
  }
  for (const name of ['Empty Trash automatically', 'Back up every', 'Keep', 'Shortcut']) {
    await expect(page.getByRole('combobox', { name, exact: true }), name).toBeVisible();
  }
  await page.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'File', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  const file = page.getByRole('menu', { name: 'File' });
  for (const name of ['Back up now…', 'Restore from backup…', 'Export all notes…', 'Import notes…']) {
    await expect(file.getByRole('menuitem', { name }), name).toBeEnabled();
  }
  // Without a note tab the note exports are disabled rather than doing nothing.
  await expect(file.getByRole('menuitem', { name: 'Export note as Markdown…' })).toBeDisabled();
  await page.keyboard.press('Escape');
});

test('narrow layouts: Home and Settings fit the minimum window without sideways scrolling', async () => {
  const { app, page } = await h.start();
  await createNote(page, COMMON, 'Narrow');
  await reloadUi(page);
  await setContentSize(app, page, 720, 480);
  const overflow = () =>
    page.evaluate(() => {
      const panel = document.querySelector('[role="tabpanel"]') as HTMLElement;
      return panel.scrollWidth - panel.clientWidth;
    });
  expect(await overflow()).toBeLessThanOrEqual(1);
  await railGo(page, 'Settings');
  await expect(page.getByRole('region', { name: 'Backup' })).toBeAttached();
  expect(await overflow()).toBeLessThanOrEqual(1);
});
