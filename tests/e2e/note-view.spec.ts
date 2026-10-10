import { expect, test, type Page } from '@playwright/test';
import { docOf, editor, editorSelectionText, editorText, nodesOf, noteMenu, saveStatus, toolbar, toolbarButton, waitSaved } from './editor-ui';
import { setContentSize } from './fixtures';
import { useApp } from './harness';
import { card } from './nlp-ui';
import { reminderDialog, reminderEnv } from './reminder-ui';
import { COMMON, createNote, reloadUi, saveDoc, saveText } from './seed';
import { stickyHeader, stickyPage } from './sticky-ui';
import { activate, activeTab, dialogByName, openFromTree, renameActiveTab, titleInput } from './ui';

const h = useApp();

const insertMenu = (page: Page) => page.getByRole('listbox', { name: 'Insert' });
const titleOf = (id: string) => h.one<{ title: string }>('SELECT title FROM notes WHERE id = ?', id)?.title;
const appRegion = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region').trim());
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

/** Moves the cursor to the end of the text and starts a new paragraph. */
async function newLine(page: Page): Promise<void> {
  await editor(page).focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
}

test('the note view is only the text, its tab is the title, with formatting, insert and note menus on demand (D-102)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await setContentSize(app, page, 1280, 800);
  const id = await createNote(page, COMMON, 'Simple');
  await saveDoc(page, id, { type: 'doc', content: [para('make this bold')] }, 'make this bold');
  await reloadUi(page);
  await openFromTree(page, id);
  await expect(activeTab(page)).toHaveText('Simple');
  await expect(editor(page)).toHaveText('make this bold');

  // Only the text: no title field, toolbar row, buttons, location line, visible save state or Details panel.
  const view = page.locator('.note-view');
  await expect(view.locator('button, input, select, [contenteditable="true"], [role="toolbar"]')).toHaveCount(1);
  await expect(titleInput(page)).toHaveCount(0);
  await expect(view.getByText('Common')).toHaveCount(0);
  await expect(saveStatus(page)).toHaveText('Saved');
  await expect(saveStatus(page)).toHaveClass(/\bsr-only\b/);
  await expect(page.getByRole('complementary', { name: 'Details' })).toHaveCount(0);

  // The tab is the title: a double-click renames it in place; Enter saves and moves into the text.
  const tab = page.locator('[role="tab"][aria-selected="true"]');
  await tab.dblclick();
  await expect(titleInput(page)).toBeFocused();
  await expect(titleInput(page)).toHaveValue('Simple');
  await page.keyboard.type('Plain and simple');
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
  await expect(titleInput(page)).toHaveCount(0);
  await expect(activeTab(page)).toHaveText('Plain and simple');
  await expect.poll(() => titleOf(id)).toBe('Plain and simple');
  // F2 on the tab renames too; Escape puts the title back and returns to the tab.
  await renameActiveTab(page);
  await page.keyboard.type('Not this');
  await page.keyboard.press('Escape');
  await expect(titleInput(page)).toHaveCount(0);
  await expect(tab).toBeFocused();
  await expect(activeTab(page)).toHaveText('Plain and simple');
  await expect.poll(() => titleOf(id)).toBe('Plain and simple');

  // A selection brings up the floating toolbar beside it; Bold applies to the selection.
  await editor(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await expect.poll(() => editorSelectionText(page)).toBe('make this bold');
  await expect(toolbar(page)).toBeVisible();
  const bubble = (await toolbar(page).boundingBox())!;
  const line = (await editor(page).locator('p').first().boundingBox())!;
  expect(bubble.y + bubble.height <= line.y + 1 || bubble.y >= line.y + line.height - 1).toBe(true);
  await toolbarButton(page, 'Bold').click();
  await expect(editor(page).locator('strong')).toHaveText('make this bold');
  await expect(toolbarButton(page, 'Bold')).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(toolbar(page)).toHaveCount(0);

  // Keyboard: Alt+F10 moves into the toolbar at the cursor, arrows move between its buttons, Escape returns to the text.
  await page.keyboard.press('Alt+F10');
  await expect(toolbarButton(page, 'Heading')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(toolbarButton(page, 'Bold')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor(page)).toBeFocused();
  await expect(toolbar(page)).toHaveCount(0);
  await waitSaved(page);
  expect(nodesOf(docOf(h, id)).find((n) => n.text === 'make this bold')?.marks).toEqual([{ type: 'bold' }]);

  // "/" after a space or at the start of a line opens the insert menu; inside a word it is plain text.
  await newLine(page);
  await page.keyboard.type('and/or');
  await expect(insertMenu(page)).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(insertMenu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(insertMenu(page)).toHaveCount(0);
  await expect.poll(() => editorText(page)).toBe('make this bold\nand/or\n/');
  await page.keyboard.press('Backspace');

  // Insert menu → "Link to note or document…": the typed command is replaced by the picker.
  await page.keyboard.type('/link');
  await expect(insertMenu(page).getByRole('option')).toHaveText(['Link to note or document…']);
  await page.keyboard.press('Enter');
  const picker = dialogByName(page, 'Link to note');
  await expect(picker).toBeVisible();
  await expect.poll(() => editorText(page)).toBe('make this bold\nand/or\n');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(editor(page)).toBeFocused();

  // Insert menu → "Create reminder from text" uses the paragraph the command was typed in.
  await page.keyboard.type('Pay rent tomorrow /rem');
  await expect(insertMenu(page).getByRole('option')).toHaveText(['Add reminder…', 'Create reminder from text']);
  await page.keyboard.press('ArrowDown');
  await expect(insertMenu(page).getByRole('option', { name: 'Create reminder from text' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByLabel('Title', { exact: true })).toHaveValue('Pay rent');
  await activate(card(page).getByRole('button', { name: 'Cancel' }));
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => editorText(page)).toBe('make this bold\nand/or\nPay rent tomorrow ');

  // Right-click opens the note menu: insert, reminders and the note's own actions.
  await editor(page).locator('p').first().click({ button: 'right' });
  await expect(noteMenu(page).getByRole('menuitem')).toHaveText([
    'Insert image',
    'Attach file',
    'Insert table…',
    'Link to note or document…',
    'Add reminder…',
    'Create reminder from text',
    'Find in note',
    'Convert to plain text…',
    'Version history…',
    'Float as sticky',
    'Lock note…',
  ]);
  await noteMenu(page).getByRole('menuitem', { name: 'Add reminder…' }).click();
  await expect(noteMenu(page)).toHaveCount(0);
  await expect(reminderDialog(page)).toBeVisible();
  await activate(reminderDialog(page).getByRole('button', { name: 'Cancel' }));
  await expect(reminderDialog(page)).toHaveCount(0);

  // The Details panel opens and closes with its single title bar toggle and remembers the choice.
  const toggle = page.getByRole('button', { name: /^Toggle details panel/ });
  const details = page.getByRole('complementary', { name: 'Details' });
  await activate(toggle);
  await expect(details.locator('dd').first()).toHaveText('Plain and simple');
  await expect(details.locator('dt', { hasText: /^Location$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('Common');
  await expect.poll(() => h.setting('layout.panelOpen')).toEqual({ v: 1, value: true });
  await activate(toggle);
  await expect(details).toHaveCount(0);
  await expect.poll(() => h.setting('layout.panelOpen')).toEqual({ v: 1, value: false });
});

test('the sticky title is edited in place; the rest of the header drags and only its controls do not (N-O2, D-102)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Groceries', { sticky: true });
  await saveText(page, id, 'milk');
  await reloadUi(page);
  await openFromTree(page, id);
  await page.evaluate((noteId) => window.infinity.sticky.float({ noteId }), id);
  const sp = await stickyPage(app, id);
  await expect(editor(sp)).toHaveText('milk');

  // The title is a field as wide as its text; the header around it drags, the controls do not.
  const header = stickyHeader(sp);
  const title = titleInput(sp);
  await expect(title).toHaveValue('Groceries');
  for (const selector of ['.sticky-header', '.sticky-badge']) expect(await appRegion(sp, selector), selector).toBe('drag');
  expect(await appRegion(sp, '.sticky-title-input')).toBe('no-drag');
  const controls = header.getByRole('button');
  await expect(controls).toHaveCount(5);
  for (const control of await controls.all()) expect(await control.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region').trim())).toBe('no-drag');
  const headerBox = (await header.boundingBox())!;
  const titleBox = (await title.boundingBox())!;
  expect(titleBox.width).toBeLessThan(headerBox.width / 3);
  // The empty header space between the controls is the drag region.
  const actionsBox = (await header.getByRole('button', { name: 'Sticky actions', exact: true }).boundingBox())!;
  const closeBox = (await header.getByRole('button', { name: 'Close sticky', exact: true }).boundingBox())!;
  expect(closeBox.x - (actionsBox.x + actionsBox.width)).toBeGreaterThan(20);
  const gapRegion = await sp.evaluate(
    ([x, y]) => getComputedStyle(document.elementFromPoint(x!, y!)!).getPropertyValue('-webkit-app-region').trim(),
    [(actionsBox.x + actionsBox.width + closeBox.x) / 2, headerBox.y + headerBox.height / 2],
  );
  expect(gapRegion).toBe('drag');

  // A click edits the title; typing and Enter rename the note (stored, and in the main window's tab) and move into the text.
  await title.click();
  await expect(title).toBeFocused();
  await sp.keyboard.press('Control+A');
  await sp.keyboard.type('Shopping');
  await sp.keyboard.press('Enter');
  await expect(editor(sp)).toBeFocused();
  await expect.poll(() => titleOf(id)).toBe('Shopping');
  await expect(title).toHaveValue('Shopping');
  await expect(activeTab(page)).toHaveText('Shopping');

  // F2 selects the title; Escape keeps it.
  await sp.keyboard.press('F2');
  await expect(title).toBeFocused();
  await sp.keyboard.type('Not this');
  await sp.keyboard.press('Escape');
  await expect(editor(sp)).toBeFocused();
  await expect(title).toHaveValue('Shopping');
  await expect.poll(() => titleOf(id)).toBe('Shopping');

  // Rename in the actions menu selects it too.
  await activate(header.getByRole('button', { name: 'Sticky actions', exact: true }));
  await activate(sp.getByRole('menu', { name: 'Sticky actions' }).getByRole('menuitem', { name: 'Rename', exact: true }));
  await expect(title).toBeFocused();
  expect(await title.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 'Shopping'.length]);
});
