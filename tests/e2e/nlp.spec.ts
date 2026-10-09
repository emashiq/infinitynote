import { expect, test, type Page } from '@playwright/test';
import { useApp } from './harness';
import { COMMON, createNote, saveDoc } from './seed';
import { activate, activeTabLabel, openFromTree, railGo, toasts } from './ui';
import { editor, editorSelectionText, focusEditorEnd } from './editor-ui';
import { floatFromTab, stickyPage } from './sticky-ui';
import { T0, advance, detailsPanel, reminderEnv, reminderRows, shownNotifications, withPanel } from './reminder-ui';
import { candidates, card, dismissalRows, openCreateFromText, sourceRows, suggestionBar, typeText, waitForCandidate, waitForCursorAtEnd } from './nlp-ui';

/**
 * Reminder suggestions from note text (Phase 06, plan section 12.4): reference R = 2026-10-08 13:00 in Asia/Dhaka
 * unless a case says otherwise. Every write goes through the UI; main's rows are read through the test hooks.
 */
const h = useApp({ failOnMainErrors: true });
const at = (iso: string) => Date.parse(iso);
const PAST_TEXT = 'This time has already passed. It will be added as overdue, without a notification.';

async function openNewNote(page: Page, title: string, format: 'rich' | 'plain' = 'rich'): Promise<string> {
  const id = await createNote(page, COMMON, title, { format });
  await openFromTree(page, id);
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'false');
  await focusEditorEnd(page);
  return id;
}

const plainText = (id: string) => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', id)?.plain_text;

/** Types a sentence, waits for its phrase to be underlined, then opens the card (cursor in the phrase). */
async function cardFor(page: Page, sentence: string, phrase: string): Promise<void> {
  await typeText(page, sentence);
  await waitForCandidate(page, phrase);
  await openCreateFromText(page);
  await expect(card(page)).toBeVisible();
}

const button = (page: Page, name: string) => card(page).getByRole('button', { name, exact: true });

test('underline, text unchanged (INF-SUG-01)', async () => {
  const { app, page } = await h.start(reminderEnv());
  const id = await openNewNote(page, 'Errands');
  await typeText(page, 'Pay rent tomorrow');
  await waitForCandidate(page, 'tomorrow');
  await expect(suggestionBar(page)).toContainText('Reminder: Fri 9 Oct, 09:00');
  // Typing on right away keeps every character and the focus.
  await typeText(page, ' and buy milk');
  await expect.poll(() => editor(page).innerText()).toBe('Pay rent tomorrow and buy milk');
  expect(await page.evaluate(() => document.activeElement?.closest('.ProseMirror') !== null)).toBe(true);
  await expect.poll(() => plainText(id)).toBe('Pay rent tomorrow and buy milk');
  await expect(candidates(page)).toHaveText(['tomorrow']);
  expect((await reminderRows(app)).reminders).toEqual([]);
});

test('underline, text unchanged (two phrases) (INF-NLP-11)', async () => {
  const { page } = await h.start(reminderEnv());
  await openNewNote(page, 'Calls');
  await typeText(page, 'call Bob tomorrow at 9 and send report on Friday');
  await expect(candidates(page)).toHaveText(['tomorrow at 9', 'on Friday'], { timeout: 5_000 });
  expect(await page.locator('.note-editor-content p').count()).toBe(1);
});

test('sticky suggestion: detect and confirm in a floated sticky; its chip is read-only (INF-SUG-01)', async () => {
  const { app, page } = await h.start(reminderEnv());
  const id = await createNote(page, COMMON, 'Plants', { sticky: true });
  await openFromTree(page, id);
  await floatFromTab(page);
  const sp = await stickyPage(app, id);
  const sticky = editor(sp);
  await expect(sticky).toHaveAttribute('aria-readonly', 'false');
  await sticky.click();
  await typeText(sp, 'Water plants tomorrow');
  await waitForCandidate(sp, 'tomorrow');
  await openCreateFromText(sp);
  await expect(card(sp)).toBeVisible();
  await expect(card(sp).getByLabel('Title', { exact: true })).toHaveValue('Water plants');
  await activate(button(sp, 'Add'));
  await expect(card(sp)).toHaveCount(0);
  const rows = await reminderRows(app);
  expect(rows.reminders).toMatchObject([{ note_id: id, title: 'Water plants', start_local_date: '2026-10-09', local_time: '09:00' }]);
  expect(await sourceRows(app)).toMatchObject([{ note_id: id, source_text: 'tomorrow', origin: 'suggestion', source_state: 'ok' }]);
  const chip = sp.locator('.reminder-chip');
  await expect(chip).toHaveAttribute('aria-label', 'Reminder: Water plants, Fri 9 Oct 2026, 09:00 · Asia/Dhaka');
  await expect(candidates(sp)).toHaveCount(0);
  await expect.poll(() => plainText(id)).toBe('Water plants tomorrow');
});

test('disclosure: the date-only default is shown and a typed time replaces it (INF-NLP-04)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await openNewNote(page, 'Bank');
  await cardFor(page, 'Call the bank tomorrow', 'tomorrow');
  await expect(card(page)).toContainText('09:00 (default time for date-only phrases)');
  await card(page).getByLabel('Time', { exact: true }).fill('10:00');
  await expect(card(page)).not.toContainText('default time for date-only phrases');
  await activate(button(page, 'Add'));
  await expect(card(page)).toHaveCount(0);
  expect((await reminderRows(app)).reminders).toMatchObject([{ start_local_date: '2026-10-09', local_time: '10:00', zone_id: 'Asia/Dhaka' }]);
});

test('choice required: date order and am/pm have no default; next year on request (INF-NLP-08)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await openNewNote(page, 'Meeting');
  await cardFor(page, 'Meet 03/04 at 5', '03/04 at 5');
  const add = button(page, 'Add');
  await expect(add).toBeDisabled();
  await expect(card(page)).toContainText('Choose the date order');
  const order = card(page).getByRole('group', { name: 'Date order' });
  await expect(order.getByRole('radio', { checked: true })).toHaveCount(0);
  await activate(order.getByRole('radio', { name: '3 April' }));
  await expect(card(page)).toContainText('Choose AM or PM');
  await activate(card(page).getByRole('group', { name: 'Time of day' }).getByRole('radio', { name: '17:00' }));
  await expect(card(page)).toContainText(PAST_TEXT);
  await activate(button(page, 'Use next year'));
  await expect(card(page)).toContainText('Saturday, 3 April 2027');
  await expect(add).toBeEnabled();
  await activate(add);
  await expect(card(page)).toHaveCount(0);
  const rows = await reminderRows(app);
  expect(rows.reminders).toMatchObject([{ start_local_date: '2027-04-03', local_time: '17:00', zone_id: 'Asia/Dhaka' }]);
  expect(rows.occurrences).toMatchObject([{ due_at_utc: at('2027-04-03T11:00:00Z') }]);
});

test('choice required (CST): an abbreviation needs an IANA zone (INF-NLP-09)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await openNewNote(page, 'Report');
  await cardFor(page, 'Report by 5 CST', '5 CST');
  await expect(card(page)).toContainText('“CST” can mean more than one time zone. Choose one.');
  await expect(card(page).getByLabel('Time zone', { exact: true })).toHaveValue('');
  await expect(button(page, 'Add')).toBeDisabled();
  await activate(button(page, 'America/Chicago'));
  await expect(button(page, 'Add')).toBeDisabled();
  await activate(card(page).getByRole('group', { name: 'Time of day' }).getByRole('radio', { name: '17:00' }));
  await activate(button(page, 'Add'));
  await expect(card(page)).toHaveCount(0);
  const rows = await reminderRows(app);
  expect(rows.reminders).toMatchObject([{ zone_id: 'America/Chicago', start_local_date: '2026-10-08', local_time: '17:00' }]);
  expect(rows.occurrences).toMatchObject([{ due_at_utc: at('2026-10-08T22:00:00Z') }]);
});

test('past date stays past: Add anyway keeps 2026 and sends no notification (INF-NLP-10)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await openNewNote(page, 'Invoice');
  await cardFor(page, 'Pay invoice on Oct 1', 'Oct 1');
  await expect(card(page)).toContainText(PAST_TEXT);
  await expect(button(page, 'Use next year')).toBeVisible();
  await activate(button(page, 'Add'));
  await expect(button(page, 'Add anyway')).toBeVisible();
  await activate(button(page, 'Add anyway'));
  await expect(card(page)).toHaveCount(0);
  const rows = await reminderRows(app);
  expect(rows.reminders).toMatchObject([{ start_local_date: '2026-10-01', local_time: '09:00' }]);
  expect(rows.occurrences).toMatchObject([{ due_at_utc: at('2026-10-01T03:00:00Z'), next_alert_at_utc: null }]);
});

test('unsupported text offers manual entry and adds an ordinary reminder (INF-NLP-12)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await openNewNote(page, 'Someday');
  await typeText(page, "Let's do it sometime");
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect.poll(() => editorSelectionText(page)).toBe("Let's do it sometime");
  await openCreateFromText(page);
  await expect(card(page)).toContainText('No date or time found in this text. Enter the date and time below.');
  await expect(card(page).getByLabel('Title', { exact: true })).toHaveValue("Let's do it sometime");
  await activate(button(page, 'Add'));
  await expect(card(page)).toHaveCount(0);
  expect((await reminderRows(app)).reminders).toMatchObject([{ title: "Let's do it sometime", start_local_date: '2026-10-09', local_time: '09:00' }]);
  expect(await sourceRows(app)).toEqual([]);
});

test('selection: More → Create reminder from text reads the selected text (INF-SUG-02)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await page.evaluate(() => window.infinity.settings.set({ key: 'reminders.suggestFromText', value: false }));
  const id = await openNewNote(page, 'Lunch');
  await typeText(page, 'Lunch with Sam on Oct 20 at 1pm');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect.poll(() => editorSelectionText(page)).toBe('Lunch with Sam on Oct 20 at 1pm');
  await expect(candidates(page)).toHaveCount(0);
  await openCreateFromText(page);
  const c = card(page);
  await expect(c.getByLabel('Title', { exact: true })).toHaveValue('Lunch with Sam');
  await expect(c).toContainText('“Oct 20 at 1pm”');
  await expect(c).toContainText('Tuesday, 20 October 2026');
  await expect(c.getByLabel('Time', { exact: true })).toHaveValue('13:00');
  await activate(button(page, 'Add'));
  await expect(c).toHaveCount(0);
  expect((await reminderRows(app)).reminders).toMatchObject([{ note_id: id, start_local_date: '2026-10-20', local_time: '13:00', zone_id: 'Asia/Dhaka' }]);
  expect(await sourceRows(app)).toMatchObject([{ source_text: 'Oct 20 at 1pm', origin: 'selection', span_start: 18, span_end: 31 }]);

  // A selection over two paragraphs is refused with a notice and opens no card.
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await typeText(page, 'Second line tomorrow');
  await page.keyboard.press('Control+A');
  await openCreateFromText(page);
  await expect(toasts(page).filter({ hasText: 'Select text within one paragraph.' })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test('card fields: phrase, reference, full date, disclosed time; a zone change reads the phrase again (INF-SUG-03)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await openNewNote(page, 'Submit');
  await cardFor(page, 'Have to submit this by tomorrow end of the day', 'tomorrow end of the day');
  const c = card(page);
  await expect(c.getByRole('heading', { name: 'Create reminder' })).toBeVisible();
  await expect(c.getByLabel('Title', { exact: true })).toHaveValue('Have to submit this');
  for (const text of ['From your note', '“tomorrow end of the day”', 'Read on Thu 8 Oct 2026, 13:00 · Asia/Dhaka', 'Friday, 9 October 2026', '17:00 (default end of day)', 'Repeat', 'Follow up if not done']) {
    await expect(c).toContainText(text);
  }
  await expect(c.getByLabel('Time', { exact: true })).toHaveValue('17:00');
  await expect(c.getByLabel('Time zone', { exact: true })).toHaveValue('Asia/Dhaka');
  await expect(button(page, 'Cancel')).toBeVisible();
  await c.getByLabel('Time zone', { exact: true }).selectOption('America/New_York');
  await expect(c.getByLabel('Preview')).toContainText('Fri 9 Oct 2026, 17:00 · America/New_York');
  await expect(c.getByLabel('Preview')).toContainText('Your time: Sat 10 Oct 2026, 03:00 · Asia/Dhaka');
  await activate(c.getByRole('radio', { name: 'Weekly' }));
  await activate(button(page, 'Add'));
  await expect(c).toHaveCount(0);
  const rows = await reminderRows(app);
  expect(rows.reminders).toMatchObject([{ zone_id: 'America/New_York', start_local_date: '2026-10-09', local_time: '17:00', recurrence: JSON.stringify({ freq: 'weekly', byWeekday: [5] }) }]);
  expect(rows.occurrences).toMatchObject([{ due_at_utc: at('2026-10-09T21:00:00Z') }]);
});

test('DST choices: a fold offers the later time, a gap moves to the first valid minute (INF-SUG-03)', async () => {
  const { app, page } = await h.start(reminderEnv({ zone: 'America/New_York' }));
  await openNewNote(page, 'Clocks');
  await cardFor(page, 'Backup on Nov 1 at 1:30am', 'Nov 1 at 1:30am');
  const c = card(page);
  await expect(c.getByLabel('Preview')).toContainText('01:30 happens twice on this date; using the earlier one');
  await activate(c.getByRole('checkbox', { name: 'Use the later one (EST)' }));
  await activate(button(page, 'Add'));
  await expect(c).toHaveCount(0);
  await expect.poll(async () => (await reminderRows(app)).reminders.length).toBe(1);
  let rows = await reminderRows(app);
  expect(rows.reminders).toMatchObject([{ fold_preference: 'later', zone_id: 'America/New_York' }]);
  expect(rows.occurrences).toMatchObject([{ due_at_utc: at('2026-11-01T06:30:00Z') }]);

  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await cardFor(page, 'Patch on March 14, 2027 at 2:30am', 'March 14, 2027 at 2:30am');
  await expect(card(page).getByLabel('Preview')).toContainText('02:30 does not exist on this date in New York; the reminder will use 03:00');
  await activate(button(page, 'Add'));
  await expect(card(page)).toHaveCount(0);
  await expect.poll(async () => (await reminderRows(app)).occurrences.length).toBe(2);
  rows = await reminderRows(app);
  expect(rows.occurrences.map((o) => o.due_at_utc)).toContain(at('2027-03-14T07:00:00Z'));
});

test('cancel creates nothing (INF-SUG-04)', async () => {
  const { app, page } = await h.start(reminderEnv());
  const id = await openNewNote(page, 'Nothing');
  await cardFor(page, 'Call the bank tomorrow', 'tomorrow');
  await page.waitForTimeout(3_000);
  await activate(button(page, 'Cancel'));
  await expect(card(page)).toHaveCount(0);
  await openCreateFromText(page);
  await expect(card(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  const rows = await reminderRows(app);
  expect([rows.reminders, rows.occurrences, await sourceRows(app)]).toEqual([[], [], []]);
  await expect.poll(() => plainText(id)).toBe('Call the bank tomorrow');
  await expect(page.locator('.reminder-chip')).toHaveCount(0);
});

test('dedupe after restart: a dismissed or confirmed phrase is not suggested again (INF-SUG-06)', async () => {
  const { app, page } = await h.start(reminderEnv());
  const id = await openNewNote(page, 'Dedupe');
  await typeText(page, 'Pay rent tomorrow');
  await waitForCandidate(page, 'tomorrow');
  await suggestionBar(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(candidates(page)).toHaveCount(0);
  await expect.poll(async () => (await dismissalRows(app)).length).toBe(1);
  await page.keyboard.press('Enter');
  await typeText(page, 'Call mum on Friday');
  await waitForCandidate(page, 'on Friday');
  await suggestionBar(page).getByRole('button', { name: 'Create reminder' }).click();
  await activate(button(page, 'Add'));
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator('.reminder-chip')).toHaveCount(1);
  await expect(candidates(page)).toHaveCount(0);
  await expect.poll(() => plainText(id)).toBe('Pay rent tomorrow\nCall mum on Friday');

  const relaunched = await h.restart(reminderEnv());
  const p2 = relaunched.page;
  await openFromTree(p2, id);
  await expect(editor(p2)).toHaveAttribute('aria-readonly', 'false');
  for (const line of [1, 2]) {
    await editor(p2).click();
    await p2.keyboard.press('Control+Home');
    if (line === 2) await p2.keyboard.press('ArrowDown');
    await p2.keyboard.press('End');
    await p2.keyboard.press('Backspace');
    await typeText(p2, line === 1 ? 'w' : 'y');
  }
  await p2.waitForTimeout(2_500);
  await expect(candidates(p2)).toHaveCount(0);
  await expect(p2.locator('.reminder-chip')).toHaveCount(1);
  expect((await reminderRows(relaunched.app)).reminders).toHaveLength(1);
});

test('restart next day keeps the instant (INF-SUG-07)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await withPanel(app, page);
  const id = await openNewNote(page, 'Bank');
  await cardFor(page, 'Call the bank tomorrow', 'tomorrow');
  await activate(button(page, 'Add'));
  await expect(card(page)).toHaveCount(0);
  await expect.poll(async () => (await reminderRows(app)).occurrences).toMatchObject([{ due_at_utc: at('2026-10-09T03:00:00Z') }]);

  const next = await h.restart(reminderEnv({ clock: '2026-10-09T05:00:00.000Z' }));
  await withPanel(next.app, next.page);
  await openFromTree(next.page, id);
  const row = detailsPanel(next.page).getByRole('listitem', { name: 'Call the bank' });
  await expect(row).toContainText('Fri 9 Oct 2026, 09:00');
  await expect(row).toContainText('Overdue');
  await expect(candidates(next.page)).toHaveCount(0);
  const rows = await reminderRows(next.app);
  expect(rows.reminders).toHaveLength(1);
  expect(rows.occurrences).toMatchObject([{ due_at_utc: at('2026-10-09T03:00:00Z') }]);
  expect(await sourceRows(next.app)).toMatchObject([{ reference_instant_utc: at(T0), source_state: 'ok' }]);
});

test('source edit requires update: nothing moves until Update (INF-SUG-08)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await withPanel(app, page);
  await openNewNote(page, 'Bank');
  await cardFor(page, 'Call the bank tomorrow', 'tomorrow');
  await activate(button(page, 'Add'));
  await expect(card(page)).toHaveCount(0);
  await expect.poll(async () => (await reminderRows(app)).occurrences.length).toBe(1);

  // Replace "tomorrow" with "next Friday".
  await focusEditorEnd(page);
  for (let i = 0; i < 'tomorrow'.length; i += 1) await page.keyboard.press('Backspace');
  await typeText(page, 'next Friday');
  const row = detailsPanel(page).getByRole('listitem', { name: 'Call the bank' });
  await expect(row).toContainText('The text this reminder came from changed: “tomorrow”.');
  await expect(page.locator('.reminder-chip')).toHaveAttribute('aria-label', /, its text changed$/);
  expect((await reminderRows(app)).occurrences).toMatchObject([{ due_at_utc: at('2026-10-09T03:00:00Z') }]);

  await activate(row.getByRole('button', { name: 'Update from text…' }));
  const c = page.getByRole('dialog', { name: 'Update reminder' });
  await expect(c).toContainText('Now: Fri 9 Oct 2026, 09:00 · Asia/Dhaka');
  await expect(c).toContainText('Friday, 16 October 2026');
  await activate(c.getByRole('button', { name: 'Update', exact: true }));
  await expect(c).toHaveCount(0);
  await expect(row).toContainText('Fri 16 Oct 2026, 09:00');
  await expect(row).not.toContainText('changed');
  await expect(page.locator('.reminder-chip')).toContainText('Fri 16 Oct, 09:00');
  expect((await reminderRows(app)).occurrences).toMatchObject([{ due_at_utc: at('2026-10-16T03:00:00Z') }]);
  expect(await sourceRows(app)).toMatchObject([{ source_text: 'next Friday', source_state: 'ok' }]);
});

test('full flow: write, preview, confirm, panel, notification opens the source (INF-SUG-10)', async () => {
  const { app, page } = await h.start(reminderEnv({ notifications: true }));
  await withPanel(app, page);
  const id = await openNewNote(page, 'Report');
  const sentence = 'Have to submit this by tomorrow end of the day';
  await typeText(page, sentence);
  await waitForCandidate(page, 'tomorrow end of the day');
  await expect(suggestionBar(page)).toContainText('Reminder: Fri 9 Oct, 17:00');
  await suggestionBar(page).getByRole('button', { name: 'Create reminder' }).click();
  await expect(card(page)).toContainText('17:00 (default end of day)');
  await activate(button(page, 'Add'));
  await expect(card(page)).toHaveCount(0);
  const row = detailsPanel(page).getByRole('listitem', { name: 'Have to submit this' });
  await expect(row).toContainText('Fri 9 Oct 2026, 17:00 · Asia/Dhaka');
  const block = await page.locator('.note-editor-content p[data-id]').first().getAttribute('data-id');
  await expect(page.locator(`[data-id="${block}"] .reminder-chip`)).toHaveAttribute('aria-label', 'Reminder: Have to submit this, Fri 9 Oct 2026, 17:00 · Asia/Dhaka');
  expect(await sourceRows(app)).toMatchObject([
    { note_id: id, block_id: block, source_text: 'tomorrow end of the day', span_start: 23, span_end: 46, span_ordinal: 0, reference_instant_utc: at(T0), reference_zone: 'Asia/Dhaka', parser_version: 1, origin: 'suggestion', source_state: 'ok' },
  ]);
  await expect.poll(() => plainText(id)).toBe(sentence);

  // Leave the note, let the reminder come due, and click its notification.
  await railGo(page, 'Home');
  await advance(app, at('2026-10-09T11:00:00Z') - at(T0));
  const shown = await shownNotifications(app);
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatchObject({ title: 'Have to submit this' });
  await app.evaluate((_e, n) => globalThis.__infinityTest!.notifications!.click(n), shown[0]!.id);
  await expect.poll(() => activeTabLabel(page)).toBe('Report');
  await expect(page.locator(`[data-id="${block}"]`)).toHaveClass(/reveal-block/);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('[data-id]')?.getAttribute('data-id') ?? null))
    .toBe(block);
});

test('large note typing stays responsive (plan section 9.4)', async () => {
  const { app, page } = await h.start(reminderEnv());
  const id = await createNote(page, COMMON, 'Long note');
  const content = Array.from({ length: 2000 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: i % 10 === 0 ? `Item ${i} is due tomorrow` : `Item ${i} has no date at all` }] }));
  await saveDoc(page, id, { type: 'doc', content });
  await openFromTree(page, id);
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'false');
  await focusEditorEnd(page);
  await waitForCursorAtEnd(page);
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[] };
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push(e.duration);
    }).observe({ type: 'longtask' });
  });
  const sentence = 'Please send the final report by tomorrow';
  expect(sentence).toHaveLength(40);
  await typeText(page, sentence, 30);
  await waitForCandidate(page, 'tomorrow');
  await expect(candidates(page)).toHaveCount(1);
  await expect(page.locator('.note-editor-content p').filter({ hasText: 'Please send' })).toHaveText([sentence]);
  await expect.poll(() => plainText(id)?.endsWith(`\n${sentence}`)).toBe(true);
  expect(plainText(id)!.split('\n')).toHaveLength(2001);
  expect((await reminderRows(app)).reminders).toEqual([]);
  const longest = await page.evaluate(() => Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks));
  console.log(`large note: 2000 paragraphs, 40 keys at 30 ms, longest longtask ${longest.toFixed(0)} ms, candidates 1`);
  expect(longest).toBeLessThan(250);
});
