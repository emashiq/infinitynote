import { expect, test } from '@playwright/test';
import { useApp } from './harness';
import { COMMON, createNote, createProject, pin, reloadUi, saveText, trashNote, trashProject } from './seed';
import { activate, activeTabLabel, chooseMenu, railGo, tabItem, tabLabels, tabs, titleInput, treeByKey } from './ui';

const h = useApp();

const homeTab = (page: import('@playwright/test').Page) => page.getByRole('tab', { name: 'Home', exact: true });

test('one Home tab after relaunch', async () => {
  const { page } = await h.start();
  await railGo(page, 'Home');
  await railGo(page, 'Home');
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox', { name: 'Type a command or search notes' }).fill('Go to Home');
  await page.keyboard.press('Enter');
  await expect(homeTab(page)).toHaveCount(1);
  await h.stop();

  h.writeWhileClosed((db) => {
    const tampered = {
      v: 1,
      value: {
        version: 1,
        tabs: [
          { id: 'page:stickies', kind: 'stickies' },
          { id: 'home', kind: 'home' },
          { id: 'home', kind: 'home' },
        ],
        activeTabId: 'home',
      },
    };
    db.prepare("INSERT INTO settings(key, value, updated_at) VALUES ('session.tabs', ?, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(tampered));
  });
  const second = await h.start();
  await expect.poll(() => tabLabels(second.page)).toEqual(['Home', 'Stickies']);
  await expect(homeTab(second.page)).toHaveCount(1);
  await expect.poll(() => activeTabLabel(second.page)).toBe('Home');
  await h.restart();
  await expect.poll(() => tabLabels(h.page)).toEqual(['Home', 'Stickies']);
});

test('Home not closable', async () => {
  const { page } = await h.start();
  await expect(page.getByRole('button', { name: 'Close Home' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Close / })).toHaveCount(0);
  const home = homeTab(page);
  await activate(home);
  await page.keyboard.press('Control+W');
  await expect(home).toHaveCount(1);
  await home.press('Delete');
  await expect(home).toHaveCount(1);
  // Pointer behavior: middle click.
  await home.click({ button: 'middle' });
  await expect(home).toHaveCount(1);
  await expect.poll(() => tabLabels(page)).toEqual(['Home']);
});

test('pinned and recent reflect data', async () => {
  const { page } = await h.start();
  const alpha = await createProject(page, 'Alpha');
  const a = await createNote(page, COMMON, 'Note A');
  const b = await createNote(page, { projectId: alpha, folderId: null }, 'Note B');
  const c = await createNote(page, COMMON, 'Note C');
  await pin(page, c);
  await saveText(page, b, 'newest edit');
  await reloadUi(page);

  const tiles = page.locator('.tiles').getByRole('button');
  await expect(tiles).toHaveText(['New note', 'New sticky', 'New project']);
  const pinned = page.getByRole('region', { name: 'Pinned' });
  await expect(pinned.locator('.card')).toHaveCount(1);
  await expect(pinned.locator('.card-title')).toHaveText('Note C');
  await expect(pinned.locator('.card-path')).toHaveText('Common');

  const rows = page.locator('.recent-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.first().locator('.recent-title')).toHaveText('Note B');
  await expect(rows.first().locator('.recent-path')).toHaveText('Alpha');
  await expect(rows.first().locator('.recent-time')).toHaveText(/just now|minute|second|ago/);
  const titles = await rows.locator('.recent-title').allTextContents();
  expect(titles[0]).toBe('Note B');
  expect(titles).toContain('Note A');
  expect(titles).toContain('Note C');

  await trashNote(page, a);
  await expect(rows).toHaveCount(2);
  expect(await rows.locator('.recent-title').allTextContents()).not.toContain('Note A');
  await expect(page.getByRole('region', { name: 'Pinned' }).getByText('Note A')).toHaveCount(0);
});

test('pin', async () => {
  const { page } = await h.start();
  const n = await createNote(page, COMMON, 'Pin me');
  await reloadUi(page);
  await expect(page.getByText('Pin a note to keep it here.')).toBeVisible();
  await chooseMenu(page, treeByKey(page, `note:${n}`), 'Pin to Home');
  await expect(page.locator('.card-title')).toHaveText('Pin me');
  await expect.poll(() => h.one<{ pinned_at: number | null }>('SELECT pinned_at FROM notes WHERE id = ?', n)?.pinned_at).not.toBeNull();

  const second = await h.restart();
  await expect(second.page.locator('.card-title')).toHaveText('Pin me');
  await chooseMenu(second.page, treeByKey(second.page, `note:${n}`), 'Unpin from Home');
  await expect(second.page.locator('.card')).toHaveCount(0);
  expect(h.one<{ pinned_at: number | null }>('SELECT pinned_at FROM notes WHERE id = ?', n)?.pinned_at).toBeNull();
  // Pinned notes opened from Home reuse one tab.
  await chooseMenu(second.page, treeByKey(second.page, `note:${n}`), 'Pin to Home');
  await activate(second.page.locator('.card'));
  await expect(tabItem(second.page, 'Pin me')).toHaveAttribute('aria-selected', 'true');
  await expect(tabs(second.page)).toHaveCount(2);
});

test('filter', async () => {
  const { page } = await h.start();
  const p = await createProject(page, 'P project');
  const q = await createProject(page, 'Q project');
  await createNote(page, COMMON, 'X common');
  await createNote(page, { projectId: p, folderId: null }, 'Y in P');
  await createNote(page, { projectId: q, folderId: null }, 'Z in Q');
  await reloadUi(page);

  const recentTitles = () => page.locator('.recent-title').allTextContents().then((t) => t.sort());
  const scope = (name: string) => page.getByRole('radiogroup', { name: 'Show notes from' }).getByRole('radio', { name, exact: true });
  await expect.poll(recentTitles).toEqual(['X common', 'Y in P', 'Z in Q']);
  await activate(scope('Common'));
  await expect.poll(recentTitles).toEqual(['X common']);
  await activate(scope('Project'));
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue(p);
  await expect.poll(recentTitles).toEqual(['Y in P']);
  await expect.poll(() => h.setting('home.scope')).toEqual({ v: 1, value: { kind: 'project', projectId: p } });

  const second = await h.restart();
  await expect(second.page.getByRole('radio', { name: 'Project', exact: true })).toBeChecked();
  await expect(second.page.getByRole('combobox', { name: 'Project' })).toHaveValue(p);
  await expect.poll(() => second.page.locator('.recent-title').allTextContents()).toEqual(['Y in P']);

  // New note under the project filter lands at the project root.
  await activate(second.page.locator('.tiles').getByRole('button', { name: 'New note' }));
  await expect(titleInput(second.page)).toBeFocused();
  await expect.poll(() => h.all('SELECT id FROM notes WHERE project_id = ? AND folder_id IS NULL', p).length).toBe(2);
  await railGo(second.page, 'Home');

  // Ctrl+Shift+N under the Common filter creates a yellow sticky at the Common root.
  await activate(second.page.getByRole('radio', { name: 'Common', exact: true }));
  await second.page.keyboard.press('Control+Shift+N');
  await expect.poll(() => h.all("SELECT id FROM notes WHERE project_id IS NULL AND folder_id IS NULL AND sticky_enabled = 1 AND color = 'yellow'").length).toBe(1);
  await railGo(second.page, 'Home');

  // Trashing the filtered project resets the filter to All.
  await activate(second.page.getByRole('radio', { name: 'Project', exact: true }));
  await expect.poll(() => h.setting('home.scope')).toEqual({ v: 1, value: { kind: 'project', projectId: p } });
  await trashProject(second.page, p);
  await expect(second.page.getByRole('radio', { name: 'All', exact: true })).toBeChecked();
  await expect.poll(() => h.setting('home.scope')).toEqual({ v: 1, value: { kind: 'all' } });
});
