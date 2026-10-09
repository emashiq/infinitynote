import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { ShownNotification } from '../../src/main/services/notification-adapter';
import type { ReminderCreateRequestType } from '../../src/shared/contracts/reminders';
import { setContentSize } from './fixtures';
import { activate } from './ui';

/** The reference instant of the Phase 05 specs: 2026-10-08 13:00 in Asia/Dhaka (plan section 12.1). */
export const T0 = '2026-10-08T07:00:00.000Z';
export const MINUTE = 60_000;

/**
 * A frozen reminder clock and a fixed computer zone (D-084; ignored by packaged builds). With `notifications`, the
 * desktop reports a notification service, so specs whose subject is the (fake) notification itself also run on WSLg,
 * which has none (D-077); without it, the real capability applies.
 */
export function reminderEnv(opts: { clock?: string; zone?: string; caps?: Record<string, string>; notifications?: boolean } = {}): Record<string, string> {
  const caps = { ...opts.caps, ...(opts.notifications ? { nativeNotifications: 'supported' } : {}) };
  return {
    INFINITY_NOTES_TEST_CLOCK: opts.clock ?? T0,
    INFINITY_NOTES_TEST_ZONE: opts.zone ?? 'Asia/Dhaka',
    ...(Object.keys(caps).length > 0 ? { INFINITY_NOTES_TEST_CAPS: JSON.stringify(caps) } : {}),
  };
}

/** Moves the frozen clock (wall and monotonic) and waits for the scheduler tick it triggered. */
export function advance(app: ElectronApplication, ms: number): Promise<void> {
  return app.evaluate((_e, m) => globalThis.__infinityTest!.clock!.advance(m), ms);
}

export function shownNotifications(app: ElectronApplication): Promise<ShownNotification[]> {
  return app.evaluate(() => globalThis.__infinityTest!.notifications!.shown());
}

export interface ReminderRows {
  reminders: Array<Record<string, unknown>>;
  occurrences: Array<Record<string, unknown>>;
  deliveries: Array<Record<string, unknown>>;
}

/** Raw reminder rows from main (a fresh task, F04-A2). */
export function reminderRows(app: ElectronApplication): Promise<ReminderRows> {
  return app.evaluate(() => globalThis.__infinityTest!.reminders()) as Promise<ReminderRows>;
}

/** Creates a reminder through the real bridge (seeding, never straight into the database). */
export async function createReminder(page: Page, req: Partial<ReminderCreateRequestType> & { noteId: string }): Promise<{ id: string; occurrenceId: string }> {
  const full = { blockId: null, title: 'Pay rent', zoneId: 'Asia/Dhaka', date: '2026-10-09', time: '17:00', recurrence: null, followup: null, ...req };
  const r = await page.evaluate((body) => window.infinity.reminder.create(body as never), full);
  if (!r.ok) throw new Error(`reminder.create failed: ${r.error.code} ${r.error.message}`);
  return { id: r.data.id, occurrenceId: r.data.current!.occurrenceId };
}

export function reminderDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: /^(Add|Edit) reminder$/ });
}

/** Fills the dialog fields that are given. */
export async function fillReminder(page: Page, f: { title?: string; date?: string; time?: string; zone?: string }): Promise<void> {
  const d = reminderDialog(page);
  if (f.title !== undefined) await d.getByLabel('Title', { exact: true }).fill(f.title);
  if (f.zone !== undefined) await d.getByLabel('Time zone', { exact: true }).selectOption(f.zone);
  if (f.date !== undefined) await d.getByLabel('Date', { exact: true }).fill(f.date);
  if (f.time !== undefined) await d.getByLabel('Time', { exact: true }).fill(f.time);
}

export async function saveReminder(page: Page): Promise<void> {
  await activate(reminderDialog(page).getByRole('button', { name: 'Save', exact: true }));
}

/** The Reminders page's rows of the selected tab. */
export function reminderRowsOnPage(page: Page): Locator {
  return page.locator('#reminders-list .reminder-row');
}

export function detailsPanel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Details' });
}

/** A main window wide enough for the docked Details panel (its Reminders section). */
export async function withPanel(app: ElectronApplication, page: Page): Promise<void> {
  await setContentSize(app, page, 1400, 860);
  await detailsPanel(page).waitFor();
}

/** The widget window's page, once it shows its header. */
export async function widgetPage(app: ElectronApplication): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(() => {
      found = app.windows().find((p) => !p.isClosed() && p.url().endsWith('#/widget'));
      return found !== undefined;
    }, { timeout: 30_000 })
    .toBe(true);
  await found!.getByRole('toolbar', { name: 'Reminder widget' }).waitFor({ timeout: 30_000 });
  return found!;
}

/** The paragraph ids of the open editor, in order. */
export function paragraphIds(page: Page): Promise<string[]> {
  return page.locator('.note-editor-content p[data-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')!));
}
