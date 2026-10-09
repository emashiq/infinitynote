import { expect, test } from '@playwright/test';
import { useApp } from './harness';
import { COMMON, createNote, createProject, saveDoc } from './seed';
import { activate, activeTabLabel, openFromTree, railGo, tabItem, toasts } from './ui';
import { chooseMore, editor, focusEditorEnd } from './editor-ui';
import { closeWindowByUrl, floatFromTab, mainPageOf, queueClose, stickyPage, windowsOf } from './sticky-ui';
import {
  MINUTE,
  T0,
  advance,
  createReminder,
  detailsPanel,
  fillReminder,
  paragraphIds,
  reminderDialog,
  reminderEnv,
  reminderRows,
  reminderRowsOnPage,
  saveReminder,
  shownNotifications,
  withPanel,
} from './reminder-ui';

const h = useApp({ failOnMainErrors: true });
const WIN = process.platform === 'win32';
const at = (iso: string) => Date.parse(iso);
const P1 = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const P2 = '2b4e28ba-2fa1-41d2-883f-0016d3cca427';
const para = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });

async function openNote(page: import('@playwright/test').Page, title: string): Promise<string> {
  const id = await createNote(page, COMMON, title);
  await openFromTree(page, id);
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'false');
  return id;
}

async function addReminderDialog(page: import('@playwright/test').Page) {
  await chooseMore(page, 'Add reminder…');
  await expect(reminderDialog(page)).toBeVisible();
}

test('add a reminder to a paragraph: chip, panel, sticky, block removed (INF-REM-01, INF-REM-04)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await withPanel(app, page);
  const id = await openNote(page, 'Bills');
  await focusEditorEnd(page);
  await page.keyboard.insertText('Pay rent');
  await expect.poll(() => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', id)?.plain_text).toBe('Pay rent');
  const [B] = await paragraphIds(page);
  const note = () => h.one<{ revision: number; updated_at: number; content_json: string }>('SELECT revision, updated_at, content_json FROM notes WHERE id = ?', id);
  const before = note();

  await addReminderDialog(page);
  const d = reminderDialog(page);
  await expect(d.getByLabel('Title', { exact: true })).toHaveValue('Pay rent');
  await expect(d.getByLabel('Time zone', { exact: true })).toHaveValue('Asia/Dhaka');
  await fillReminder(page, { date: '2026-10-09', time: '17:00' });
  await expect(d.getByLabel('Preview')).toContainText('Fri 9 Oct 2026, 17:00 · Asia/Dhaka');
  await saveReminder(page);
  await expect(d).toHaveCount(0);
  const rows = await reminderRows(app);
  expect(rows.reminders).toMatchObject([{ block_id: B, zone_id: 'Asia/Dhaka', title: 'Pay rent', anchor_state: 'ok' }]);
  expect(rows.occurrences).toMatchObject([{ due_at_utc: at('2026-10-09T11:00:00Z'), next_alert_at_utc: at('2026-10-09T11:00:00Z'), state: 'pending' }]);
  const chip = page.locator(`[data-id="${B}"] .reminder-chip`);
  await expect(chip).toHaveAttribute('aria-label', 'Reminder: Pay rent, Fri 9 Oct 2026, 17:00 · Asia/Dhaka');
  await expect(chip).toHaveAttribute('contenteditable', 'false');
  expect(note()).toEqual(before);
  await expect(detailsPanel(page).getByRole('listitem', { name: 'Pay rent' })).toBeVisible();

  // Typing after the text keeps the chip out of the content.
  await focusEditorEnd(page);
  await page.keyboard.insertText(' now');
  await expect.poll(() => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', id)?.plain_text).toBe('Pay rent now');
  expect(note()!.content_json).not.toContain('Fri 9 Oct');

  // Copy and paste never carry a chip.
  await editor(page).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  const pasted = await openNote(page, 'Pasted');
  await editor(page).focus();
  await page.keyboard.press('Control+V');
  await expect.poll(() => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', pasted)?.plain_text).toBe('Pay rent now');

  // The sticky of the note shows the same chip, read-only.
  await openFromTree(page, id);
  await floatFromTab(page);
  const sp = await stickyPage(app, id);
  await expect(sp.locator(`[data-id="${B}"] .reminder-chip`)).toHaveAttribute('aria-label', 'Reminder: Pay rent, Fri 9 Oct 2026, 17:00 · Asia/Dhaka');
  await closeWindowByUrl(app, `#/sticky/${id}`);
  await expect.poll(async () => (await windowsOf(app)).stickies).toEqual([]);

  // Removing the paragraph keeps the reminder on the note with "Original text was removed".
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'false');
  await editor(page).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await reminderRows(app)).reminders[0]!.anchor_state).toBe('block_missing');
  await expect(page.getByRole('group', { name: 'Note reminders' }).getByRole('button')).toContainText('Original text was removed');
  const row = detailsPanel(page).getByRole('listitem', { name: 'Pay rent' });
  await expect(row.getByRole('button', { name: 'Attach to current paragraph' })).toBeVisible();
  await activate(row.getByRole('button', { name: 'Keep note-level' }));
  await expect.poll(async () => (await reminderRows(app)).reminders[0]).toMatchObject({ block_id: null, anchor_state: 'ok' });
  await expect(page.getByRole('group', { name: 'Note reminders' }).getByRole('button', { name: 'Reminder: Pay rent, Fri 9 Oct 2026, 17:00 · Asia/Dhaka' })).toBeVisible();
});

test('default zone follows the computer and the setting (INF-REM-02)', async () => {
  const { page } = await h.start(reminderEnv({ zone: 'America/Chicago' }));
  await openNote(page, 'Zones');
  await addReminderDialog(page);
  await expect(reminderDialog(page).getByLabel('Time zone', { exact: true })).toHaveValue('America/Chicago');
  await activate(reminderDialog(page).getByRole('button', { name: 'Cancel' }));
  await railGo(page, 'Settings');
  const select = page.getByLabel('Default time zone for new reminders');
  await expect(select.locator('option').first()).toHaveText('Computer time zone (America/Chicago)');
  await select.selectOption('Asia/Dhaka');
  await expect.poll(() => h.setting('reminders.defaultZone')).toEqual({ v: 1, value: 'Asia/Dhaka' });
  await activate(tabItem(page, 'Zones'));
  await addReminderDialog(page);
  await expect(reminderDialog(page).getByLabel('Time zone', { exact: true })).toHaveValue('Asia/Dhaka');
  await activate(reminderDialog(page).getByRole('button', { name: 'Cancel' }));
  await activate(tabItem(page, 'Settings'));
  await page.getByLabel('Default time zone for new reminders').selectOption('');
  await expect.poll(() => h.setting('reminders.defaultZone')).toEqual({ v: 1, value: null });
});

test('selected zone and local time; DST gap and fold previews; past times (INF-REM-03, INF-REM-14)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await withPanel(app, page);
  const id = await openNote(page, 'Calls');
  await addReminderDialog(page);
  const d = reminderDialog(page);
  await fillReminder(page, { title: 'New York call', zone: 'America/New_York', date: '2026-10-09', time: '09:00' });
  await expect(d.getByLabel('Preview')).toContainText('Fri 9 Oct 2026, 09:00 · America/New_York');
  await expect(d.getByLabel('Preview')).toContainText('Your time: Fri 9 Oct 2026, 19:00 · Asia/Dhaka');
  await saveReminder(page);
  const ny = detailsPanel(page).getByRole('listitem', { name: 'New York call' });
  await expect(ny).toContainText('Fri 9 Oct 2026, 09:00 · America/New_York');
  await expect(ny).toContainText('Your time: Fri 9 Oct 2026, 19:00 · Asia/Dhaka');
  await createReminder(page, { noteId: id, title: 'Dhaka call' });
  await expect(detailsPanel(page).getByRole('listitem', { name: 'Dhaka call' })).not.toContainText('Your time');
  await railGo(page, 'Reminders');
  await activate(page.getByRole('tab', { name: /^Upcoming, / }));
  await expect(reminderRowsOnPage(page).filter({ hasText: 'New York call' })).toContainText('Your time: Fri 9 Oct 2026, 19:00 · Asia/Dhaka');

  // DST gap in March: 02:30 does not exist; it is in the past here, so the past flow runs first.
  await openFromTree(page, id);
  await addReminderDialog(page);
  await fillReminder(page, { title: 'Gap', zone: 'America/New_York', date: '2026-03-08', time: '02:30' });
  await expect(d.getByLabel('Preview')).toContainText('02:30 does not exist on this date in New York; the reminder will use 03:00');
  await saveReminder(page);
  await expect(d.getByRole('alert')).toContainText('This time has already passed. It will be added as overdue, without a notification.');
  await activate(d.getByRole('button', { name: 'Add anyway' }));
  await expect(d).toHaveCount(0);
  // Fold in November: the later one on request.
  await addReminderDialog(page);
  await fillReminder(page, { title: 'Fold', zone: 'America/New_York', date: '2026-11-01', time: '01:30' });
  await expect(d.getByLabel('Preview')).toContainText('01:30 happens twice on this date; using the earlier one');
  await activate(d.getByRole('checkbox', { name: 'Use the later one (EST)' }));
  await saveReminder(page);
  await expect(d).toHaveCount(0);
  const rows = await reminderRows(app);
  const byTitle = (title: string) => rows.reminders.find((r) => r.title === title)!;
  const due = (title: string) => rows.occurrences.find((o) => o.reminder_id === byTitle(title).id)!;
  expect(due('Gap')).toMatchObject({ due_at_utc: at('2026-03-08T07:00:00Z'), next_alert_at_utc: null });
  expect(byTitle('Fold')).toMatchObject({ fold_preference: 'later' });
  expect(due('Fold')).toMatchObject({ due_at_utc: at('2026-11-01T06:30:00Z') });
});

test('reminders page, done and empty texts; Home reminder section (INF-REM-05, INF-REM-09, INF-HOME-04)', async () => {
  const { app, page } = await h.start(reminderEnv());
  const id = await createNote(page, COMMON, 'Errands');
  const project = await createProject(page, 'Work');
  const work = await createNote(page, { projectId: project, folderId: null }, 'Work note');
  await createReminder(page, { noteId: id, title: 'Buy milk', date: '2026-10-08', time: '18:00' });
  await createReminder(page, { noteId: id, title: 'Call mom', date: '2026-10-08', time: '20:00' });
  await createReminder(page, { noteId: id, title: 'Dentist', date: '2026-10-10', time: '10:00' });
  await createReminder(page, { noteId: work, title: 'Report', date: '2026-10-08', time: '12:00', allowPast: true } as never);
  await railGo(page, 'Reminders');
  await expect(page.getByRole('tab', { name: 'Today, 2' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Upcoming, 1' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overdue, 1' })).toBeVisible();
  await expect(reminderRowsOnPage(page)).toHaveCount(2);
  await activate(reminderRowsOnPage(page).filter({ hasText: 'Buy milk' }).getByRole('button', { name: 'Done' }));
  await expect(page.getByRole('tab', { name: 'Today, 1' })).toBeVisible();
  await expect.poll(async () => (await reminderRows(app)).occurrences.filter((o) => o.state === 'completed')).toHaveLength(1);
  await activate(page.getByRole('tab', { name: 'Completed' }));
  await expect(reminderRowsOnPage(page).filter({ hasText: 'Buy milk' })).toContainText('Done');

  // Home: Overdue and Due today, the scope filter, the link.
  await railGo(page, 'Home');
  const home = page.getByRole('region', { name: 'Reminders' });
  await expect(home.getByRole('group', { name: 'Overdue' })).toContainText('Report');
  await expect(home.getByRole('group', { name: 'Due today' })).toContainText('Call mom');
  // The Home filter Common hides the project note's reminder.
  await activate(page.getByRole('radiogroup', { name: 'Show notes from' }).getByRole('radio', { name: 'Common' }));
  await expect(home.getByRole('group', { name: 'Overdue' })).toHaveCount(0);
  await expect(home.getByRole('group', { name: 'Due today' })).toContainText('Call mom');
  await activate(page.getByRole('radiogroup', { name: 'Show notes from' }).getByRole('radio', { name: 'All' }));
  await expect(home.getByRole('group', { name: 'Overdue' })).toContainText('Report');
  await activate(home.getByRole('button', { name: 'Open Reminders' }));
  await expect.poll(() => activeTabLabel(page)).toBe('Reminders');
  await expect(page.getByRole('tab', { name: 'Overdue, 1' })).toHaveAttribute('aria-selected', 'true');

  // Six overdue: Home lists five; an empty notebook says so.
  for (let i = 0; i < 5; i += 1) await createReminder(page, { noteId: id, title: `Late ${i}`, date: '2026-10-08', time: `0${i}:00`, allowPast: true } as never);
  await railGo(page, 'Home');
  await expect(home.getByRole('group', { name: 'Overdue' }).locator('li')).toHaveCount(5);
  await page.evaluate(async () => {
    const view = await window.infinity.reminders.listView({ view: 'upcoming' });
    if (view.ok) for (const item of view.data.items) await window.infinity.reminder.delete({ reminderId: item.reminderId });
  });
  await activate(page.getByRole('tab', { name: 'Reminders' }));
  await activate(page.getByRole('tab', { name: 'Upcoming, 0' }));
  await expect(page.getByText('No upcoming reminders.')).toBeVisible();
  // Nothing at all: Home says so.
  await page.evaluate(async () => {
    for (const view of ['overdue', 'today'] as const) {
      const list = await window.infinity.reminders.listView({ view });
      if (list.ok) for (const item of list.data.items) await window.infinity.reminder.delete({ reminderId: item.reminderId });
    }
  });
  await railGo(page, 'Home');
  await expect(home).toContainText('Nothing overdue or due today.');
});

test('notification click opens the source note; in the background; summary opens Overdue (INF-REM-06, INF-REM-07)', async () => {
  const { app, page } = await h.start(reminderEnv({ notifications: true }));
  const a = await createNote(page, COMMON, 'A');
  const b = await createNote(page, COMMON, 'B');
  await saveDoc(page, b, { type: 'doc', content: [para(P1, 'First'), para(P2, 'Pay the invoice')] });
  await createReminder(page, { noteId: b, blockId: P2, title: 'Invoice', zoneId: 'UTC', date: '2026-10-08', time: '07:01' });
  await openFromTree(page, a);
  await advance(app, MINUTE);
  const [first] = await shownNotifications(app);
  expect(first).toMatchObject({ title: 'Invoice', body: 'Due Thu 8 Oct, 07:01 · B' });
  await app.evaluate((_e, n) => globalThis.__infinityTest!.notifications!.click(n), first!.id);
  await expect.poll(() => activeTabLabel(page)).toBe('B');
  await expect(page.locator(`[data-id="${P2}"]`)).toHaveClass(/reveal-block/);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('[data-id]')?.getAttribute('data-id') ?? null))
    .toBe(P2);
  await expect.poll(async () => (await reminderRows(app)).deliveries[0]!.clicked_at).toBe(at(T0) + MINUTE);

  // The main window closed to the background: the alert still goes out, and a click brings the window back.
  await createReminder(page, { noteId: b, title: 'Later', zoneId: 'UTC', date: '2026-10-08', time: '07:03' });
  await queueClose(app, 'background', false);
  await closeWindowByUrl(app, '#/');
  await expect.poll(async () => (await windowsOf(app)).main).toBeNull();
  await advance(app, 2 * MINUTE);
  const second = (await shownNotifications(app))[1]!;
  expect(second.title).toBe('Later');
  expect(await windowsOf(app)).toMatchObject({ main: null });
  await app.evaluate((_e, n) => globalThis.__infinityTest!.notifications!.click(n), second.id);
  const main = await mainPageOf(app);
  await main.waitForSelector('#app-shell[data-ready="true"]');
  await expect.poll(() => activeTabLabel(main)).toBe('B');

  // Four due at once: one summary; its click opens Reminders on Overdue.
  for (let i = 0; i < 4; i += 1) await createReminder(main, { noteId: a, title: `Batch ${i}`, zoneId: 'UTC', date: '2026-10-08', time: '07:05' });
  await advance(app, 2 * MINUTE);
  const summary = (await shownNotifications(app)).at(-1)!;
  expect(summary).toMatchObject({ title: 'Infinity Notes', body: '4 reminders are overdue' });
  await app.evaluate((_e, n) => globalThis.__infinityTest!.notifications!.click(n), summary.id);
  await expect.poll(() => activeTabLabel(main)).toBe('Reminders');
  await expect(main.getByRole('tab', { name: /^Overdue, / })).toHaveAttribute('aria-selected', 'true');
});

test('banner when notifications fail or are unsupported; Done in the banner (INF-SCHED-04, INF-REM-16)', async () => {
  const { app, page } = await h.start(reminderEnv(WIN ? { caps: { nativeNotifications: 'unsupported' } } : {}));
  const caps = await page.evaluate(async () => (await window.infinity.capabilities.get()).ok);
  expect(caps).toBe(true);
  const id = await createNote(page, COMMON, 'Rent');
  await createReminder(page, { noteId: id, title: 'Pay rent', zoneId: 'UTC', date: '2026-10-08', time: '07:01' });
  await advance(app, MINUTE);
  const banner = page.getByRole('status', { name: 'Reminder alerts' });
  await expect(banner).toContainText('Reminder: Pay rent');
  for (const name of ['Open', 'Snooze', 'Done', 'Dismiss']) await expect(banner.getByRole('button', { name, exact: true })).toBeVisible();
  expect(await shownNotifications(app)).toEqual([]);
  expect((await reminderRows(app)).deliveries).toMatchObject([{ outcome: 'unsupported', detail: WIN ? 'test-override' : 'no-notification-server' }]);
  await activate(banner.getByRole('button', { name: 'Done', exact: true }));
  await expect.poll(async () => (await reminderRows(app)).occurrences[0]!.state).toBe('completed');
  await expect(banner).toHaveCount(0);
  await railGo(page, 'Settings');
  await expect(page.getByText('This desktop has no notification service. Reminders appear inside Infinity Notes and in the reminder widget instead.')).toBeVisible();

  // A notification that fails: recorded as failed, same banner.
  await app.evaluate(() => {
    globalThis.__infinityTest!.notifications!.mode = 'fail';
  });
  await createReminder(page, { noteId: id, title: 'Water plants', zoneId: 'UTC', date: '2026-10-08', time: '07:03' });
  await advance(app, 2 * MINUTE);
  await expect(banner).toContainText('Reminder: Water plants');
});

test('a failed notification shows the banner (INF-SCHED-04)', async () => {
  const { app, page } = await h.start(reminderEnv({ notifications: true }));
  await app.evaluate(() => {
    globalThis.__infinityTest!.notifications!.mode = 'fail';
  });
  const id = await createNote(page, COMMON, 'Rent');
  await createReminder(page, { noteId: id, title: 'Pay rent', zoneId: 'UTC', date: '2026-10-08', time: '07:01' });
  await advance(app, MINUTE);
  await expect(page.getByRole('status', { name: 'Reminder alerts' })).toContainText('Reminder: Pay rent');
  expect((await reminderRows(app)).deliveries).toMatchObject([{ outcome: 'failed', detail: 'test failure' }]);
});

test('edit a series with an overdue occurrence (INF-REM-13)', async () => {
  const { app, page } = await h.start(reminderEnv({ clock: '2026-10-08T02:00:00.000Z' }));
  await withPanel(app, page);
  const id = await openNote(page, 'Stand-up');
  await createReminder(page, { noteId: id, title: 'Stand-up', date: '2026-10-08', time: '09:00', recurrence: { freq: 'daily' } });
  await advance(app, 2 * 60 * MINUTE);
  const row = detailsPanel(page).getByRole('listitem', { name: 'Stand-up' });
  await expect(row).toContainText('Overdue');
  await activate(row.getByRole('button', { name: 'Edit' }));
  const d = reminderDialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole('radio', { name: 'Keep the current overdue reminder' })).toHaveCount(0);
  await fillReminder(page, { time: '10:00' });
  await expect(d.getByText('This reminder has an overdue occurrence.')).toBeVisible();
  await expect(d.getByRole('radio', { name: 'Keep the current overdue reminder' })).toBeChecked();
  await saveReminder(page);
  await expect(d).toHaveCount(0);
  const rows = await reminderRows(app);
  expect(rows.occurrences.map((o) => [o.due_at_utc, o.state])).toEqual([
    [at('2026-10-08T03:00:00Z'), 'pending'],
    [at('2026-10-09T04:00:00Z'), 'pending'],
  ]);
  await railGo(page, 'Reminders');
  await activate(page.getByRole('tab', { name: /^Upcoming, / }));
  await expect(reminderRowsOnPage(page)).toContainText('Fri 9 Oct 2026, 10:00 · Asia/Dhaka');
});

test('os zone change: display and defaults follow, stored reminders do not (INF-REM-15)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await withPanel(app, page);
  const id = await openNote(page, 'Travel');
  await createReminder(page, { noteId: id, title: 'Flight', zoneId: 'America/New_York', date: '2026-10-09', time: '09:00' });
  const row = detailsPanel(page).getByRole('listitem', { name: 'Flight' });
  await expect(row).toContainText('Your time: Fri 9 Oct 2026, 19:00 · Asia/Dhaka');
  const before = await reminderRows(app);
  await app.evaluate(() => globalThis.__infinityTest!.zone!.set('Europe/London'));
  await expect(row).toContainText('Your time: Fri 9 Oct 2026, 14:00 · Europe/London');
  const after = await reminderRows(app);
  expect(after.reminders).toEqual(before.reminders);
  expect(after.occurrences).toEqual(before.occurrences);
  await addReminderDialog(page);
  await expect(reminderDialog(page).getByLabel('Time zone', { exact: true })).toHaveValue('Europe/London');
});

test('delete with undo (INF-REM-18)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await withPanel(app, page);
  const id = await openNote(page, 'Undo');
  await createReminder(page, { noteId: id, title: 'Keep me' });
  const row = detailsPanel(page).getByRole('listitem', { name: 'Keep me' });
  await activate(row.getByRole('button', { name: 'Delete' }));
  await expect(row).toHaveCount(0);
  const notice = toasts(page).filter({ hasText: 'Reminder deleted' });
  await activate(notice.getByRole('button', { name: 'Undo' }));
  await expect(detailsPanel(page).getByRole('listitem', { name: 'Keep me' })).toBeVisible();
  expect((await reminderRows(app)).reminders[0]!.deleted_at).toBeNull();
});

test('settings explain the lifecycle; follow-ups and quiet hours store their values (INF-REM-11, INF-SCHED-06, INF-SCHED-09, INF-DESK-03)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await railGo(page, 'Settings');
  await expect(
    page.getByText(
      'Reminders only fire while Infinity Notes is running: with a window open, in the background or in the tray. After you quit, nothing is sent until you start the app again, and then overdue reminders are shown.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Reminders and stickies only work while the app is running.')).toBeVisible();
  const startup = page.getByRole('switch', { name: 'Start Infinity Notes when you sign in' });
  await expect(startup).toBeDisabled();
  await expect(startup).toHaveAttribute('title', 'Available in the installed app');
  await activate(page.getByRole('switch', { name: 'Quiet hours' }));
  await expect.poll(() => h.setting('reminders.quietHours')).toEqual({ v: 1, value: { enabled: true, start: '22:00', end: '07:00', zoneId: 'Asia/Dhaka' } });
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('22:00');

  // Follow-ups: off by default in the dialog; switched on they start at 15 minutes, twice.
  const id = await openNote(page, 'Follow');
  await addReminderDialog(page);
  const d = reminderDialog(page);
  const followup = d.getByRole('switch', { name: 'Follow up if not done' });
  await expect(followup).toHaveAttribute('aria-checked', 'false');
  await activate(followup);
  await expect(d.getByLabel('Every')).toHaveValue('15');
  await expect(d.getByLabel('At most')).toHaveValue('2');
  await fillReminder(page, { date: '2026-10-09', time: '17:00' });
  await saveReminder(page);
  await expect(d).toHaveCount(0);
  expect((await reminderRows(app)).reminders).toMatchObject([{ note_id: id, followup_interval_minutes: 15, max_followups: 2 }]);
});
