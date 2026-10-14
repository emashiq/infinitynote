import { expect, test, type Page } from '@playwright/test';
import { DateTime } from 'luxon';
import { docOf, editor, editorText, focusEditorEnd, nodesOf, paletteAction, waitSaved } from './editor-ui';
import { useApp } from './harness';
import { settingsSection } from './portability-ui';
import { COMMON, createNote, reloadUi } from './seed';
import { stickyPage } from './sticky-ui';
import { openFromTree } from './ui';

/** Math results (D-188, D-189): "7+5=" suggests 12 in notes and stickies; variables, dates and recalculation. */
const h = useApp({ failOnMainErrors: true });

const ghost = (page: Page) => page.locator('.calc-ghost');

/**
 * Puts the cursor at the end of the paragraph with this text. ProseMirror reads a selection made with the mouse or the
 * arrow keys on the asynchronous selectionchange event, so this waits until the editor's own cursor is there.
 */
async function cursorAtEndOf(page: Page, text: string) {
  await editor(page).getByText(text, { exact: true }).click();
  await page.keyboard.press('End');
  await expect
    .poll(() =>
      editor(page).evaluate((el) => {
        const { $head } = (el as unknown as { editor: { state: { selection: { $head: { parent: { textContent: string }; parentOffset: number } } } } }).editor.state.selection;
        return [$head.parent.textContent, $head.parentOffset];
      }),
    )
    .toEqual([text, text.length]);
}

/** The days from today to a date, written as the calculator writes them. */
function daysUntil(year: number, month: number, day: number): string {
  const n = Math.round(DateTime.fromObject({ year, month, day }).diff(DateTime.now().startOf('day'), 'days').days);
  return `${n} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
}

test('a note suggests results, Tab and Enter insert them, Esc dismisses; variables recalculate and dates subtract', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'Budget');
  await reloadUi(page);
  await openFromTree(page, id);
  await focusEditorEnd(page);

  await page.keyboard.type('7+5=');
  await expect(ghost(page)).toHaveText('12');
  await page.keyboard.press('Tab');
  await expect(ghost(page)).toHaveCount(0);

  await page.keyboard.press('Enter');
  await page.keyboard.type('Lunch = 25');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Lunch * 2 =');
  await expect(ghost(page)).toHaveText(' 50');
  await page.keyboard.press('Enter');

  // Esc dismisses; Enter then starts a new line as usual.
  await page.keyboard.press('Enter');
  await page.keyboard.type('25-12-2030 - 25-12-2029 =');
  await expect(ghost(page)).toHaveText(' 365 days');
  await page.keyboard.press('Escape');
  await expect(ghost(page)).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.keyboard.type('25-12-2026 - today =');
  const untilChristmas = daysUntil(2026, 12, 25);
  await expect(ghost(page)).toHaveText(` ${untilChristmas}`);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.type('today + 3 weeks =');
  await expect(ghost(page)).toHaveText(` ${DateTime.now().plus({ weeks: 3 }).setLocale('en-US').toFormat('LLL d, yyyy')}`);
  await page.keyboard.press('Escape');

  expect((await editorText(page)).split('\n').slice(0, 6)).toEqual([
    '7+5=12',
    'Lunch = 25',
    'Lunch * 2 = 50',
    '25-12-2030 - 25-12-2029 =',
    `25-12-2026 - today = ${untilChristmas}`,
    'today + 3 weeks =',
  ]);

  // A changed variable rewrites the results that read it.
  await cursorAtEndOf(page, 'Lunch = 25');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('30');
  await expect.poll(async () => (await editorText(page)).split('\n')[2]).toBe('Lunch * 2 = 60');

  // Results are stored with their mark.
  await waitSaved(page);
  const results = nodesOf(docOf(h, id)).filter((n) => n.marks?.some((m) => m.type === 'calcResult')).map((n) => n.text);
  expect(results).toEqual(['12', '60', untilChristmas]);
});

test('a sticky shares the editor and the setting: Suggest, Insert automatically and Off', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Sums', { sticky: true });
  await page.evaluate((noteId) => window.infinity.sticky.float({ noteId }), id);
  const sticky = await stickyPage(app, id);
  await expect(editor(sticky)).toHaveAttribute('aria-readonly', 'false');
  await editor(sticky).focus();

  await sticky.keyboard.type('2*21=');
  await expect(ghost(sticky)).toHaveText('42');
  await sticky.keyboard.press('Enter');
  await expect(editor(sticky)).toHaveText('2*21=42');

  // Settings > Notes and attachments > Math results, in the main window; the sticky follows at once.
  await paletteAction(page, 'Open Settings');
  await settingsSection(page, 'Notes and attachments').getByLabel('Math results').selectOption('insert');
  await expect.poll(() => h.setting('notes.mathResults')).toEqual({ v: 1, value: 'insert' });
  await editor(sticky).focus();
  await sticky.keyboard.press('Control+End');
  await sticky.keyboard.press('Enter');
  await sticky.keyboard.type('6*7 =');
  await expect.poll(() => editor(sticky).evaluate((el) => el.textContent)).toBe('2*21=426*7 = 42');
  await expect(ghost(sticky)).toHaveCount(0);

  await settingsSection(page, 'Notes and attachments').getByLabel('Math results').selectOption('off');
  await expect.poll(() => h.setting('notes.mathResults')).toEqual({ v: 1, value: 'off' });
  await editor(sticky).focus();
  await sticky.keyboard.press('Control+End');
  await sticky.keyboard.press('Enter');
  await sticky.keyboard.type('1+1=');
  await sticky.keyboard.press('Tab');
  await expect(ghost(sticky)).toHaveCount(0);
  await expect.poll(() => editor(sticky).evaluate((el) => [...el.children].map((c) => c.textContent))).toEqual(['2*21=42', '6*7 = 42', '1+1=']);
});
