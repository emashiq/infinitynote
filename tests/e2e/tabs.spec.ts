import { expect, test } from '@playwright/test';
import { setContentSize } from './fixtures';
import { useApp } from './harness';
import { COMMON, createFolder, createNote, favorite, reloadUi, saveText } from './seed';
import { activate, activeTabLabel, openByPalette, openFromTree, railGo, tabItem, tabLabels, tabs, toasts, treeByKey } from './ui';
import { editorText } from './editor-ui';

const h = useApp();

interface StoredSession {
  v: 1;
  value: { version: 1; tabs: Array<{ id: string; kind: string; noteId?: string }>; activeTabId: string };
}
const storedSession = () => h.setting('session.tabs') as StoredSession | undefined;

test('no duplicate tabs', async () => {
  const { page } = await h.start();
  const a = await createNote(page, COMMON, 'Alpha tab note');
  await saveText(page, a, 'alpha text');
  await favorite(page, 'note', a);
  await reloadUi(page);

  await openFromTree(page, a);
  await expect(tabItem(page, 'Alpha tab note')).toHaveAttribute('aria-selected', 'true');
  await openFromTree(page, a);
  await railGo(page, 'Home');
  await expect.poll(() => activeTabLabel(page)).toBe('Home');
  await activate(page.locator('.recent-row', { hasText: 'Alpha tab note' }));
  await expect.poll(() => activeTabLabel(page)).toBe('Alpha tab note');
  await railGo(page, 'Home');
  await openByPalette(page, 'Alpha tab note');
  await expect.poll(() => activeTabLabel(page)).toBe('Alpha tab note');
  await railGo(page, 'Home');
  const group = treeByKey(page, 'favorites');
  await group.focus();
  await group.press('ArrowRight');
  const fav = treeByKey(page, `fav:note:${a}`);
  await fav.focus();
  await fav.press('Enter');
  await expect.poll(() => activeTabLabel(page)).toBe('Alpha tab note');

  await expect.poll(() => tabLabels(page)).toEqual(['Home', 'Alpha tab note']);
  await expect.poll(() => storedSession()?.value.tabs.map((t) => t.id)).toEqual(['home', `note:${a}`]);
});

test('ctrl+tab', async () => {
  const { page } = await h.start();
  const a = await createNote(page, COMMON, 'Tab A');
  const b = await createNote(page, COMMON, 'Tab B');
  await reloadUi(page);
  await openFromTree(page, a);
  await openFromTree(page, b);
  await railGo(page, 'Settings');
  await expect.poll(() => tabLabels(page)).toEqual(['Home', 'Tab A', 'Tab B', 'Settings']);

  // Pointer behavior: clicking a tab activates it.
  await tabItem(page, 'Tab B').click();
  await expect.poll(() => activeTabLabel(page)).toBe('Tab B');
  const seen: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Control+Tab');
    await expect.poll(() => activeTabLabel(page)).not.toBe(seen.at(-1) ?? 'Tab B');
    seen.push(await activeTabLabel(page));
  }
  expect(seen).toEqual(['Settings', 'Home', 'Tab A', 'Tab B']);
  const back: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    await page.keyboard.press('Control+Shift+Tab');
    await expect.poll(() => activeTabLabel(page)).not.toBe(back.at(-1) ?? 'Tab B');
    back.push(await activeTabLabel(page));
  }
  expect(back).toEqual(['Tab A', 'Home']);
  await page.keyboard.press('Control+Shift+Tab');
  await expect.poll(() => activeTabLabel(page)).toBe('Settings');
});

test('keyboard tablist', async () => {
  const { page } = await h.start();
  const a = await createNote(page, COMMON, 'Key A');
  await reloadUi(page);
  await openFromTree(page, a);
  const strip = page.getByRole('tablist', { name: 'Open tabs' });
  const active = tabItem(page, 'Key A');
  await active.focus();
  await active.press('ArrowLeft');
  await expect(tabItem(page, 'Home')).toBeFocused();
  await expect.poll(() => activeTabLabel(page)).toBe('Key A');
  await tabItem(page, 'Home').press('ArrowRight');
  await expect(active).toBeFocused();
  await active.press('ArrowRight');
  await expect(tabItem(page, 'Home')).toBeFocused();
  await tabItem(page, 'Home').press('Enter');
  await expect.poll(() => activeTabLabel(page)).toBe('Home');
  // Roving tabindex: exactly one tab is in the tab order.
  expect(await strip.getByRole('tab').evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length)).toBe(1);
});

test('close keeps note', async () => {
  const { page } = await h.start();
  const ids: string[] = [];
  for (const t of ['Close A', 'Close B', 'Close C']) {
    const id = await createNote(page, COMMON, t);
    await saveText(page, id, `text of ${t}`);
    ids.push(id);
  }
  await reloadUi(page);
  for (const id of ids) await openFromTree(page, id);
  await expect.poll(() => tabLabels(page)).toEqual(['Home', 'Close A', 'Close B', 'Close C']);

  await activate(tabItem(page, 'Close A'));
  await page.keyboard.press('Control+W');
  await expect(tabItem(page, 'Close A')).toHaveCount(0);
  await expect.poll(() => activeTabLabel(page)).toBe('Close B');

  // Pointer behaviors: the close button and a middle click.
  await page.getByRole('button', { name: 'Close Close B' }).click();
  await expect(tabItem(page, 'Close B')).toHaveCount(0);
  await expect.poll(() => activeTabLabel(page)).toBe('Close C');
  await tabItem(page, 'Close C').click({ button: 'middle' });
  await expect(tabItem(page, 'Close C')).toHaveCount(0);
  await expect.poll(() => activeTabLabel(page)).toBe('Home');

  const rows = h.all<{ id: string; deleted_at: number | null }>('SELECT id, deleted_at FROM notes');
  expect(rows).toHaveLength(3);
  expect(rows.every((r) => r.deleted_at === null)).toBe(true);
  await openFromTree(page, ids[1]!);
  await expect.poll(() => editorText(page)).toBe('text of Close B');
});

test('overflow list', async () => {
  const { app, page } = await h.start();
  await setContentSize(app, page, 1100, 720);
  const ids: string[] = [];
  for (let i = 1; i <= 15; i += 1) ids.push(await createNote(page, COMMON, `Many ${String(i).padStart(2, '0')}`));
  await reloadUi(page);
  for (const id of ids) await openFromTree(page, id);
  await expect(tabs(page)).toHaveCount(16);

  const list = page.getByRole('tablist', { name: 'Open tabs' });
  const dims = await list.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(dims.sw).toBeGreaterThan(dims.cw);
  const left = page.getByRole('button', { name: 'Scroll tabs left' });
  const right = page.getByRole('button', { name: 'Scroll tabs right' });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await expect.poll(() => list.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const before = await list.evaluate((el) => el.scrollLeft);
  await left.click();
  await expect.poll(() => list.evaluate((el) => el.scrollLeft)).toBeLessThan(before);
  const mid = await list.evaluate((el) => el.scrollLeft);
  await right.click();
  await expect.poll(() => list.evaluate((el) => el.scrollLeft)).toBeGreaterThan(mid);

  const allTabs = page.getByRole('button', { name: 'All tabs' });
  await activate(allTabs);
  const items = page.getByRole('menu', { name: 'All tabs' }).getByRole('menuitemradio');
  await expect(items).toHaveCount(16);
  await expect(items.filter({ has: page.locator('xpath=self::*[@aria-checked="true"]') })).toHaveCount(1);
  expect(await items.last().getAttribute('aria-checked')).toBe('true');
  await items.filter({ hasText: 'Many 01' }).focus();
  await page.keyboard.press('Enter');
  await expect(tabItem(page, 'Many 01')).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(async () => {
      const t = (await tabItem(page, 'Many 01').boundingBox())!;
      const l = (await list.boundingBox())!;
      return t.x >= l.x - 1 && t.x + t.width <= l.x + l.width + 1;
    })
    .toBe(true);

  await activate(allTabs);
  await expect(page.getByRole('menu', { name: 'All tabs' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(allTabs).toBeFocused();
});

test('restore after relaunch', async () => {
  const { page } = await h.start();
  const a = await createNote(page, COMMON, 'Rest A');
  const b = await createNote(page, COMMON, 'Rest B');
  const c = await createNote(page, COMMON, 'Rest C');
  await saveText(page, b, 'body of B');
  await reloadUi(page);
  await openFromTree(page, a);
  await openFromTree(page, b);
  await railGo(page, 'Stickies');
  await openFromTree(page, c);
  await activate(tabItem(page, 'Rest B'));
  await expect.poll(() => storedSession()?.value.activeTabId).toBe(`note:${b}`);
  await expect.poll(() => storedSession()?.value.tabs.length).toBe(5);

  const second = await h.restart();
  await expect.poll(() => tabLabels(second.page)).toEqual(['Home', 'Rest A', 'Rest B', 'Stickies', 'Rest C']);
  await expect.poll(() => activeTabLabel(second.page)).toBe('Rest B');
  await expect.poll(() => editorText(second.page)).toBe('body of B');
  await h.stop();

  h.writeWhileClosed((db) => {
    const tampered = {
      v: 1,
      value: {
        version: 1,
        tabs: [
          { id: 'home', kind: 'home' },
          { id: `note:${a}`, kind: 'note', noteId: a },
          { id: `note:${a}`, kind: 'note', noteId: a },
          { id: `note:${b}`, kind: 'note', noteId: b },
          { id: `note:${a}`, kind: 'note', noteId: a },
        ],
        activeTabId: `note:${a}`,
      },
    };
    db.prepare("UPDATE settings SET value = ? WHERE key = 'session.tabs'").run(JSON.stringify(tampered));
  });
  const third = await h.start();
  await expect.poll(() => tabLabels(third.page)).toEqual(['Home', 'Rest A', 'Rest B']);
  await expect.poll(() => activeTabLabel(third.page)).toBe('Rest A');
  await expect(toasts(third.page)).toHaveCount(0);
});

test('trashed note tab closed', async () => {
  const { page } = await h.start();
  const a = await createNote(page, COMMON, 'Keep A');
  const b = await createNote(page, COMMON, 'Trash B');
  const folder = await createFolder(page, { projectId: null, parentId: null }, 'Doomed');
  const n1 = await createNote(page, { projectId: null, folderId: folder }, 'In folder one');
  const n2 = await createNote(page, { projectId: null, folderId: folder }, 'In folder two');
  await reloadUi(page);
  await openFromTree(page, a);
  await openFromTree(page, b);
  await expect.poll(() => activeTabLabel(page)).toBe('Trash B');

  const row = treeByKey(page, `note:${b}`);
  await row.focus();
  await row.press('Delete');
  const dialog = page.getByRole('dialog', { name: 'Move to Trash?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Move to Trash' }).focus();
  await page.keyboard.press('Enter');
  await expect(tabItem(page, 'Trash B')).toHaveCount(0);
  await expect.poll(() => activeTabLabel(page)).toBe('Keep A');
  await expect(toasts(page).filter({ hasText: '1 tab was closed because its note is in Trash' })).toBeVisible();

  const folderRow = treeByKey(page, `folder:${folder}`);
  await folderRow.focus();
  await folderRow.press('ArrowRight');
  await openFromTree(page, n1);
  await openFromTree(page, n2);
  await expect(tabs(page)).toHaveCount(4);
  await folderRow.focus();
  await folderRow.press('Delete');
  await page.getByRole('dialog', { name: 'Move to Trash?' }).getByRole('button', { name: 'Move to Trash' }).focus();
  await page.keyboard.press('Enter');
  await expect(tabs(page)).toHaveCount(2);
  await expect(toasts(page).filter({ hasText: '2 tabs were closed because their notes are in Trash' })).toBeVisible();
  await expect.poll(() => tabLabels(page)).toEqual(['Home', 'Keep A']);
});

test('session skips trashed and missing', async () => {
  const { page } = await h.start();
  const c = await createNote(page, COMMON, 'Gone C');
  const d = await createNote(page, COMMON, 'Gone D');
  const e = await createNote(page, COMMON, 'Stays E');
  await reloadUi(page);
  for (const id of [c, d, e]) await openFromTree(page, id);
  await expect.poll(() => storedSession()?.value.tabs.length).toBe(4);
  await h.stop();

  h.writeWhileClosed((db) => {
    db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(Date.now(), c);
    db.prepare('DELETE FROM notes WHERE id = ?').run(d);
  });
  const second = await h.start();
  await expect.poll(() => tabLabels(second.page)).toEqual(['Home', 'Stays E']);
  await expect(toasts(second.page).filter({ hasText: '2 tabs were closed because their notes are in Trash or no longer exist' })).toBeVisible();
  await expect.poll(() => storedSession()?.value.tabs.map((t) => t.id)).toEqual(['home', `note:${e}`]);
});

test('page singletons', async () => {
  const { page } = await h.start();
  for (const name of ['Stickies', 'Reminders', 'Settings'] as const) {
    await railGo(page, name);
    await railGo(page, name);
  }
  await expect.poll(() => tabLabels(page)).toEqual(['Home', 'Stickies', 'Reminders', 'Settings']);
  await railGo(page, 'Home');
  for (const label of ['Open Settings', 'Open Reminders', 'Open Stickies']) {
    await page.keyboard.press('Control+K');
    await page.getByRole('combobox').fill(label);
    await page.keyboard.press('Enter');
  }
  await expect.poll(() => tabLabels(page)).toEqual(['Home', 'Stickies', 'Reminders', 'Settings']);
  await expect.poll(() => activeTabLabel(page)).toBe('Stickies');
  await activate(tabItem(page, 'Settings'));
  await page.keyboard.press('Control+W');
  await expect(tabItem(page, 'Settings')).toHaveCount(0);
  await expect.poll(() => storedSession()?.value.tabs.map((t) => t.id)).toEqual(['home', 'page:stickies', 'page:reminders']);
  const second = await h.restart();
  await expect.poll(() => tabLabels(second.page)).toEqual(['Home', 'Stickies', 'Reminders']);
});
