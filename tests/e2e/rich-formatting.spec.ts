import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { chooseNoteMenu, docOf, editor, focusEditorEnd, nodesOf, openFormatting, paste, seedClipboardHtml, toolbar, toolbarButton, waitSaved, type DocNode } from './editor-ui';
import { useApp } from './harness';
import { COMMON, createNote, reloadUi, saveText } from './seed';
import { openFromTree } from './ui';

/** v0.2.0: the note view fills the pane, tables, and font, size and color formatting. */
const h = useApp({ failOnMainErrors: true });

async function openNote(title: string, text?: string) {
  const launched = await h.start();
  const id = await createNote(launched.page, COMMON, title);
  if (text !== undefined) await saveText(launched.page, id, text);
  await reloadUi(launched.page);
  await openFromTree(launched.page, id);
  await expect(editor(launched.page)).toHaveAttribute('aria-readonly', 'false');
  return { ...launched, id };
}

/** The stored tables as rows of cell texts, with the cell types of their first row. */
function storedTables(doc: DocNode): Array<{ rows: string[][]; headerRow: boolean }> {
  const textOf = (n: DocNode): string => nodesOf(n).map((x) => x.text ?? '').join('');
  return nodesOf(doc)
    .filter((n) => n.type === 'table')
    .map((t) => ({
      rows: (t.content ?? []).map((row) => (row.content ?? []).map(textOf)),
      headerRow: (t.content?.[0]?.content ?? []).every((c) => c.type === 'tableHeader'),
    }));
}

/** Chooses an item of a toolbar menu (Font, Font size, Heading, Table) with the keyboard. */
async function chooseToolbarMenu(page: Page, button: string, item: string): Promise<void> {
  await openFormatting(page);
  const opener = toolbarButton(page, button);
  await opener.focus();
  await opener.press('Enter');
  const entry = page.getByRole('menu', { name: button }).getByRole(/^(Font|Font size|Heading)$/.test(button) ? 'menuitemradio' : 'menuitem', { name: item, exact: true });
  await entry.focus();
  await entry.press('Enter');
}

/** Opens a color popover of the toolbar (Text color, Highlight). */
async function openColor(page: Page, button: 'Text color' | 'Highlight') {
  await openFormatting(page);
  const opener = toolbarButton(page, button);
  await opener.focus();
  await opener.press('Enter');
  return page.getByRole('dialog', { name: button });
}

const writeClipboardText = (app: ElectronApplication, text: string) => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text);

test('the note text fills the pane: the scrollbar is at the pane edge and the text starts at the left', async () => {
  const lines = Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of a long note that needs a scrollbar to show everything it holds.`);
  const { page } = await openNote('Layout', lines.join('\n'));
  const geometry = () =>
    page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const scroll = document.querySelector<HTMLElement>('.note-editor-scroll')!;
      return {
        pane: box('.tab-panel'),
        scroll: scroll.getBoundingClientRect(),
        scrollbarWidth: scroll.offsetWidth - scroll.clientWidth,
        overflows: scroll.scrollHeight > scroll.clientHeight,
        text: box('.note-editor-content p'),
      };
    });
  const g = await geometry();
  expect(g.overflows).toBe(true);
  // The scrolling area reaches the pane's right edge, so its scrollbar is there, not beside the text.
  expect(Math.abs(g.scroll.right - g.pane.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.scroll.left - g.pane.left)).toBeLessThanOrEqual(1);
  if (process.platform === 'win32') expect(g.scrollbarWidth).toBeGreaterThan(0);
  // No empty gutter: the text starts after the normal padding and uses the width up to the scrollbar.
  expect(g.text.left - g.pane.left).toBeGreaterThanOrEqual(24);
  expect(g.text.left - g.pane.left).toBeLessThanOrEqual(40);
  expect(g.scroll.right - g.scrollbarWidth - g.text.right).toBeLessThanOrEqual(40);

  // The floating toolbar still sits over the selected text inside the pane.
  await editor(page).focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await openFormatting(page);
  const bar = (await toolbar(page).boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(g.pane.left);
  expect(bar.x + bar.width).toBeLessThanOrEqual(g.pane.right);
});

test('tables: insert from "/", type with Tab, change rows from the note menu, copy as tab-separated text, paste spreadsheet tables', async () => {
  const { app, page, id } = await openNote('Budget', 'Intro');
  await focusEditorEnd(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/table');
  await expect(page.getByRole('listbox', { name: 'Insert' }).getByRole('option').first()).toHaveText('Table');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Insert table' });
  await expect(dialog.getByRole('spinbutton', { name: 'Rows' })).toHaveValue('3');
  await expect(dialog.getByRole('spinbutton', { name: 'Columns' })).toHaveValue('3');
  await expect(dialog.getByRole('checkbox', { name: 'Header row' })).toBeChecked();
  await dialog.getByRole('spinbutton', { name: 'Rows' }).fill('2');
  await dialog.getByRole('spinbutton', { name: 'Columns' }).fill('2');
  await dialog.getByRole('spinbutton', { name: 'Columns' }).press('Enter');
  await expect(dialog).toBeHidden();
  for (const [i, cell] of ['Item', 'Cost', 'Rent', '900'].entries()) {
    if (i > 0) await page.keyboard.press('Tab');
    await page.keyboard.insertText(cell);
  }
  await waitSaved(page);
  await expect.poll(() => storedTables(docOf(h, id))).toEqual([
    {
      rows: [
        ['Item', 'Cost'],
        ['Rent', '900'],
      ],
      headerRow: true,
    },
  ]);

  // Tab in the last cell adds a row; the note menu edits the table at the cursor.
  await page.keyboard.press('Tab');
  await page.keyboard.insertText('Food');
  await chooseNoteMenu(page, 'Add column right');
  await waitSaved(page);
  await expect.poll(() => storedTables(docOf(h, id))[0]?.rows).toEqual([
    ['Item', '', 'Cost'],
    ['Rent', '', '900'],
    ['Food', '', ''],
  ]);
  // Into the new column, then delete it again.
  await page.keyboard.press('Tab');
  await chooseNoteMenu(page, 'Delete column');
  await waitSaved(page);
  await expect.poll(() => storedTables(docOf(h, id))[0]?.rows).toEqual([
    ['Item', 'Cost'],
    ['Rent', '900'],
    ['Food', ''],
  ]);

  // Copy: the clipboard gets the HTML table and tab-separated text.
  await editor(page).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/^Intro\n\nItem\tCost\nRent\t900\nFood\t(\n|$)/);
  const html = await app.evaluate(async ({ clipboard }) => {
    const [item] = await clipboard.read();
    return item ? (await item.getType('text/html')).text() : '';
  });
  expect(html).toContain('<table');

  // Paste a spreadsheet's HTML table (styles and scripts stripped) and then plain tab-separated text.
  await page.keyboard.press('Control+End');
  await seedClipboardHtml(
    app,
    '<table><tr><td style="color:#ff0000;position:fixed" onclick="window.__pwned=1">Q1</td><td>Q2</td></tr><tr><td>10</td><td>20</td></tr></table>',
    'Q1\tQ2\n10\t20',
  );
  await paste(page);
  await waitSaved(page);
  await expect.poll(() => storedTables(docOf(h, id)).length).toBe(2);
  expect(storedTables(docOf(h, id))[1]!.rows).toEqual([
    ['Q1', 'Q2'],
    ['10', '20'],
  ]);
  expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
  await page.keyboard.press('Control+End');
  await writeClipboardText(app, 'North\tSouth\r\n5\t7\r\n');
  await paste(page);
  await waitSaved(page);
  await expect.poll(() => storedTables(docOf(h, id))[2]?.rows).toEqual([
    ['North', 'South'],
    ['5', '7'],
  ]);
  // Cell text is searchable.
  const found = await page.evaluate(() => window.infinity.search.query({ query: 'South' }));
  expect(found).toMatchObject({ ok: true, data: { results: [{ note: { id } }] } });
});

test('font, size, text color and highlight are stored and come back after a restart', async () => {
  const { page, id } = await openNote('Styled', 'Important words');
  await editor(page).focus();
  await page.keyboard.press('Control+A');
  await chooseToolbarMenu(page, 'Font', 'Georgia');
  await chooseToolbarMenu(page, 'Font size', '24');
  const textColor = await openColor(page, 'Text color');
  const red = textColor.getByRole('radio', { name: 'Red' });
  await red.focus();
  await red.press('Enter');
  await expect(textColor).toBeHidden();
  const highlight = await openColor(page, 'Highlight');
  await highlight.getByRole('textbox', { name: 'Highlight: custom color' }).fill('#C5E1FF');
  await highlight.getByRole('textbox', { name: 'Highlight: custom color' }).press('Enter');
  await expect(highlight).toBeHidden();
  await waitSaved(page);
  await expect
    .poll(() => nodesOf(docOf(h, id)).find((n) => n.text === 'Important words')?.marks)
    .toEqual([{ type: 'textStyle', attrs: { color: '#e03131', backgroundColor: '#c5e1ff', fontFamily: 'georgia', fontSize: '24px' } }]);

  const second = await h.restart();
  await openFromTree(second.page, id);
  const span = editor(second.page).locator('span[style]').first();
  await expect(span).toHaveText('Important words');
  const style = await span.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor, size: s.fontSize, family: s.fontFamily };
  });
  expect(style).toMatchObject({ color: 'rgb(224, 49, 49)', background: 'rgb(197, 225, 255)', size: '24px' });
  expect(style.family).toMatch(/^Georgia/);
});
