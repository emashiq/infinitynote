import type { Locator, Page } from '@playwright/test';

/**
 * Keyboard activation (D-050): steps whose subject is not pointer behavior focus the control and press
 * Enter (Space for radios, checkboxes and switches), which works with and without compositor frame callbacks.
 */
export async function activate(locator: Locator): Promise<void> {
  await locator.focus();
  const useSpace = await locator.evaluate((el) => {
    const input = el as HTMLInputElement;
    return input.type === 'radio' || input.type === 'checkbox' || el.getAttribute('role') === 'switch';
  });
  await locator.press(useSpace ? 'Space' : 'Enter');
}

export function tabItem(page: Page, label: string): Locator {
  return page.getByRole('tab', { name: label, exact: true });
}

export function tabs(page: Page): Locator {
  return page.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');
}

export function tabLabels(page: Page): Promise<string[]> {
  return tabs(page).locator('.tab-label').allTextContents();
}

export function treeByKey(page: Page, key: string): Locator {
  return page.locator(`[id="tree-${key}"]`);
}

/** The tree row with exactly this label (favorite shortcuts excluded). */
export function treeItem(page: Page, label: string): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page
    .locator('[role="treeitem"]:not([id^="tree-fav:"])')
    .filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${escaped}$`) }) });
}

export async function openContextMenu(row: Locator): Promise<void> {
  await row.focus();
  await row.press('Shift+F10');
}

export function menuItem(page: Page, name: string): Locator {
  return page.getByRole('menu').getByRole('menuitem', { name, exact: true });
}

export function primaryNav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Primary' });
}

export async function railGo(page: Page, name: 'Home' | 'Notes' | 'Stickies' | 'Reminders' | 'Settings'): Promise<void> {
  await activate(primaryNav(page).getByRole('button', { name, exact: true }));
}

export async function activeTabLabel(page: Page): Promise<string> {
  return (await page.locator('[role="tab"][aria-selected="true"] .tab-label').textContent()) ?? '';
}

/** Opens a note through the command palette with the keyboard (types the full title, Enter on the first match). */
export async function openByPalette(page: Page, title: string): Promise<void> {
  await page.keyboard.press('Control+K');
  const input = page.getByRole('combobox', { name: 'Type a command or search notes' });
  await input.fill(title);
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('option', { name: new RegExp(escaped) }).first().waitFor({ state: 'visible' });
  await page.keyboard.press('Enter');
}

/** Opens a note from its tree row (the row must be visible) with Enter. */
export async function openFromTree(page: Page, noteId: string): Promise<void> {
  const row = treeByKey(page, `note:${noteId}`);
  await row.focus();
  await row.press('Enter');
}

export function toasts(page: Page): Locator {
  return page.locator('.toasts .toast');
}

/** Expands each tree row in order (rows must become visible as the previous ones expand). */
export async function expandRows(page: Page, keys: string[]): Promise<void> {
  for (const key of keys) {
    const row = treeByKey(page, key);
    await row.waitFor({ state: 'visible' });
    if ((await row.getAttribute('aria-expanded')) === 'false') {
      await row.focus();
      await row.press('ArrowRight');
      await row.page().locator(`[id="tree-${key}"][aria-expanded="true"]`).waitFor();
    }
  }
}

/** Moves tree focus to a row with arrow keys only (so the tree selection follows), starting at the first row. */
export async function arrowToRow(page: Page, key: string): Promise<void> {
  const first = page.getByRole('tree', { name: 'Notes tree' }).getByRole('treeitem').first();
  await first.focus();
  await first.press('Home');
  for (let i = 0; i < 80; i += 1) {
    const id = await page.evaluate(() => document.activeElement?.id ?? '');
    if (id === `tree-${key}`) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`could not reach tree row ${key} with the keyboard`);
}

export function dialogByName(page: Page, name: string | RegExp): Locator {
  return page.getByRole('dialog', { name });
}

/** Submits the open name dialog with the given name (keyboard only). */
export async function submitNameDialog(page: Page, title: string, name: string): Promise<void> {
  const dialog = dialogByName(page, title);
  await dialog.waitFor({ state: 'visible' });
  const input = dialog.getByLabel('Name');
  await input.fill(name);
  await input.press('Enter');
  await dialog.waitFor({ state: 'detached' });
}

/** Opens a row's context menu and chooses an item, all with the keyboard. */
export async function chooseMenu(page: Page, row: Locator, item: string): Promise<void> {
  await openContextMenu(row);
  const entry = menuItem(page, item);
  await entry.waitFor({ state: 'visible' });
  await entry.focus();
  await entry.press('Enter');
}

/** Confirms the open confirmation dialog by focusing its confirm button and pressing Enter. */
export async function confirmDialog(page: Page, title: string, button: string): Promise<void> {
  const dialog = dialogByName(page, title);
  await dialog.waitFor({ state: 'visible' });
  const btn = dialog.getByRole('button', { name: button, exact: true });
  await btn.focus();
  await btn.press('Enter');
  await dialog.waitFor({ state: 'detached' });
}

/** The note title field (getByLabel('Title') would also match 'Untitled' tab labels). */
export function titleInput(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Title', exact: true });
}
