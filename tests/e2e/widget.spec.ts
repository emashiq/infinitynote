import { expect, test } from '@playwright/test';
import { useApp } from './harness';
import { COMMON, createNote } from './seed';
import { activate, activeTabLabel, railGo } from './ui';
import { pressClosing } from './sticky-ui';
import { MINUTE, advance, createReminder, reminderEnv, reminderRows, reminderRowsOnPage, shownNotifications, widgetPage } from './reminder-ui';

const h = useApp({ failOnMainErrors: true });
const WIN = process.platform === 'win32';

const widgetInfo = (app: import('@playwright/test').ElectronApplication) => app.evaluate(() => globalThis.__infinityTest!.widget());
const widgetRow = () => h.one<{ open: number; collapsed: number; always_on_top: number; bounds: string | null }>("SELECT open, collapsed, always_on_top, bounds FROM window_state WHERE key = 'widget'");

test('actions: default off, tabs with counts, Snooze, Done and Open (INF-WIDG-01, INF-REM-16)', async () => {
  const { app, page } = await h.start(reminderEnv());
  expect(await widgetInfo(app)).toBeNull();
  expect(widgetRow()).toBeUndefined();
  const id = await createNote(page, COMMON, 'Source');
  await createReminder(page, { noteId: id, title: 'Late', date: '2026-10-08', time: '12:00', allowPast: true } as never);
  await createReminder(page, { noteId: id, title: 'Tonight', date: '2026-10-08', time: '20:00' });
  await createReminder(page, { noteId: id, title: 'Tomorrow', date: '2026-10-09', time: '09:00' });
  await railGo(page, 'Reminders');
  await activate(page.getByRole('button', { name: 'Show widget' }));
  const w = await widgetPage(app);
  expect(w.url()).toMatch(/#\/widget$/);
  await expect(page.getByRole('button', { name: 'Hide widget' })).toBeVisible();
  await expect(w.getByRole('tab', { name: 'Overdue, 1' })).toHaveAttribute('aria-selected', 'true');
  await expect(w.getByRole('tab', { name: 'Today, 1' })).toBeVisible();
  await expect(w.getByRole('tab', { name: 'Upcoming, 1' })).toBeVisible();
  const late = w.locator('.reminder-row').filter({ hasText: 'Late' });
  await expect(late).toContainText('Thu 8 Oct 2026, 12:00 · Asia/Dhaka');
  await activate(late.getByRole('button', { name: 'Snooze' }));
  await activate(w.getByRole('menu', { name: 'Snooze' }).getByRole('menuitem', { name: '10 minutes' }));
  await expect.poll(async () => (await reminderRows(app)).occurrences.find((o) => o.due_at_utc === Date.parse('2026-10-08T06:00:00Z'))!.state).toBe('snoozed');
  await expect(w.getByRole('tab', { name: 'Overdue, 0' })).toBeVisible();
  // Done in the widget updates the main window's page without a reload.
  await activate(w.getByRole('tab', { name: 'Today, 2' }));
  await activate(w.locator('.reminder-row').filter({ hasText: 'Tonight' }).getByRole('button', { name: 'Done' }));
  await expect(page.getByRole('tab', { name: 'Today, 1' })).toBeVisible();
  await expect.poll(async () => (await reminderRows(app)).occurrences.filter((o) => o.state === 'completed')).toHaveLength(1);
  // Open shows the note in the main window.
  await activate(w.locator('.reminder-row').filter({ hasText: 'Late' }).getByRole('button', { name: 'Open' }));
  await expect.poll(() => activeTabLabel(page)).toBe('Source');
});

test('collapse, hide and pin; restored after a restart (INF-WIDG-02)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await page.evaluate(() => window.infinity.widget.show());
  const w = await widgetPage(app);
  const header = w.getByRole('toolbar', { name: 'Reminder widget' });
  await activate(header.getByRole('button', { name: 'Collapse widget' }));
  await expect.poll(async () => (await widgetInfo(app))?.contentSize?.[1]).toBe(36);
  expect((await widgetInfo(app))?.resizable).toBe(false);
  await expect(w.locator('.widget-body')).toBeHidden();
  expect(widgetRow()!.collapsed).toBe(1);
  await activate(header.getByRole('button', { name: 'Expand widget' }));
  await expect.poll(async () => (await widgetInfo(app))?.resizable).toBe(true);
  expect((await widgetInfo(app))!.contentSize![1]).toBeGreaterThan(36);

  const pin = header.getByRole('button', { name: 'Keep on top' });
  const caps = await page.evaluate(async () => (await window.infinity.capabilities.get()) as { ok: true; data: { alwaysOnTop: { status: string } } });
  if (caps.data.alwaysOnTop.status === 'unsupported') {
    await expect(pin).toHaveAttribute('aria-disabled', 'true');
    await expect(pin).toHaveAttribute('title', 'Not supported by this desktop');
    expect(await w.evaluate(() => window.infinity.widget.setPinned({ pinned: true }))).toEqual({ ok: false, error: { code: 'UNSUPPORTED', message: 'Not supported by this desktop' } });
    expect(widgetRow()!.always_on_top).toBe(0);
  } else {
    await activate(pin);
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await widgetInfo(app))?.alwaysOnTop).toBe(true);
    expect(widgetRow()!.always_on_top).toBe(1);
  }

  const size = (await widgetInfo(app))!.bounds!;
  await pressClosing(header.getByRole('button', { name: 'Hide widget' }));
  await expect.poll(() => widgetInfo(app)).toBeNull();
  expect(widgetRow()!.open).toBe(0);
  if (WIN) {
    await app.evaluate(() => globalThis.__infinityTest!.tray!.click('Show widget'));
    await widgetPage(app);
    await expect.poll(async () => (await widgetInfo(app))?.bounds?.width).toBe(size.width);
  } else {
    await page.evaluate(() => window.infinity.widget.show());
    await widgetPage(app);
  }
  // Quit with the widget open: it comes back at the next start, and the quit never waited for it.
  const second = await h.restart(reminderEnv());
  await widgetPage(second.app);
  expect(widgetRow()!.open).toBe(1);
});

test('one scheduler for both windows (INF-WIDG-03)', async () => {
  const { app, page } = await h.start(reminderEnv({ notifications: true }));
  const id = await createNote(page, COMMON, 'Shared');
  await createReminder(page, { noteId: id, title: 'Shared alert', zoneId: 'UTC', date: '2026-10-08', time: '07:01' });
  await page.evaluate(() => window.infinity.widget.show());
  await widgetPage(app);
  await page.evaluate(() => window.infinity.widget.hide());
  await expect.poll(() => widgetInfo(app)).toBeNull();
  const ticks = await app.evaluate(() => globalThis.__infinityTest!.scheduler!.ticks());
  await advance(app, MINUTE);
  expect(await app.evaluate(() => globalThis.__infinityTest!.scheduler!.ticks())).toBe(ticks + 1);
  expect(await shownNotifications(app)).toHaveLength(1);
  expect(await app.evaluate(() => globalThis.__infinityTest!.scheduler!.timer())).toMatchObject({ armed: true });
  await page.evaluate(() => window.infinity.widget.show());
  const w = await widgetPage(app);
  await expect(w.getByRole('tab', { name: 'Overdue, 1' })).toHaveAttribute('aria-selected', 'true');
  await expect(w.locator('.reminder-row')).toContainText('Shared alert');
  expect(await app.evaluate(() => globalThis.__infinityTest!.scheduler!.timer())).toMatchObject({ armed: true });
  await railGo(page, 'Reminders');
  await activate(page.getByRole('tab', { name: /^Overdue, / }));
  await activate(reminderRowsOnPage(page).filter({ hasText: 'Shared alert' }).getByRole('button', { name: 'Done' }));
  await expect(w.getByText('Nothing is overdue.')).toBeVisible({ timeout: 2_000 });
});
