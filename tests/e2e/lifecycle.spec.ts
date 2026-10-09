import { expect, test, type ElectronApplication } from '@playwright/test';
import { appArgs, appEnv, appExecutable, readMainLog, spawnAndWait, waitForExit } from './fixtures';
import { useApp } from './harness';
import { COMMON, createNote, saveText } from './seed';
import { activate, activeTabLabel, openFromTree, railGo } from './ui';
import { T0, createReminder, reminderEnv, shownNotifications } from './reminder-ui';
import { editor } from './editor-ui';
import { closeWindowByUrl, mainPageOf, queueClose, stickyMenu, stickyNoteIds, stickyPage, windowCount, windowsOf } from './sticky-ui';

const h = useApp({ failOnMainErrors: true });

const WIN = process.platform === 'win32';
const RELAUNCH = 'If no tray icon appears, launching Infinity Notes again brings this window back.';

const noteText = (id: string) => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', id)!.plain_text;
const closeDialogs = (app: ElectronApplication) => app.evaluate(() => globalThis.__infinityTest!.closeDialogs.map((d) => ({ ...d })));
const alive = (app: ElectronApplication) => app.process().exitCode === null && app.process().signalCode === null;

async function typeEnd(page: import('@playwright/test').Page, text: string): Promise<void> {
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'false');
  await editor(page).focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(text);
}

/** A second launch of the app on the same profile; it hands over to the running one and exits. */
async function secondLaunch(): Promise<void> {
  const second = await spawnAndWait(appExecutable(), appArgs(), appEnv(h.userData), 15_000);
  expect(second.timedOut).toBe(false);
  expect(second.code).toBe(0);
}

async function closeMainToBackground(app: ElectronApplication, remember = false): Promise<void> {
  await queueClose(app, 'background', remember);
  await closeWindowByUrl(app, '#/');
  await expect.poll(async () => (await windowsOf(app)).main).toBeNull();
}

test('main window to background keeps stickies usable (INF-STKY-12)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Background');
  await page.evaluate((n) => window.infinity.sticky.float({ noteId: n }), id);
  const sp = await stickyPage(app, id);
  await closeMainToBackground(app);
  expect(alive(app)).toBe(true);
  expect(await windowCount(app)).toBe(1);
  await expect.poll(async () => (await windowsOf(app)).stickies.map((s) => s.visible)).toEqual([true]);
  await typeEnd(sp, 'still typing');
  await expect.poll(() => noteText(id)).toBe('still typing');
  expect(readMainLog(h.userData)).toContain('window: main closed to background');
});

test('quit flushes every window (INF-STKY-12)', async () => {
  const { app, page } = await h.start();
  const a = await createNote(page, COMMON, 'Quit A');
  const b = await createNote(page, COMMON, 'Quit B');
  const m = await createNote(page, COMMON, 'Quit main');
  await page.evaluate(([x, y]) => Promise.all([window.infinity.sticky.float({ noteId: x! }), window.infinity.sticky.float({ noteId: y! })]), [a, b]);
  const spA = await stickyPage(app, a);
  const spB = await stickyPage(app, b);
  await openFromTree(page, m);
  await typeEnd(page, 'main unsaved');
  await typeEnd(spA, 'a unsaved');
  await typeEnd(spB, 'b unsaved');
  const proc = app.process();
  await stickyMenu(spA, 'Quit Infinity Notes');
  expect(await waitForExit(proc, 20_000)).toBe(true);
  expect(readMainLog(h.userData)).toContain('flush: requested=3 acked=3 timedOut=0');
  expect([noteText(m), noteText(a), noteText(b)]).toEqual(['main unsaved', 'a unsaved', 'b unsaved']);
  expect(h.all<{ open: number }>('SELECT open FROM window_state ORDER BY note_id').map((r) => r.open)).toEqual([1, 1]);
});

test('quit from the tray flushes every window (INF-STKY-12, Windows)', async () => {
  test.skip(!WIN, 'Windows always has a tray; Linux trays depend on a StatusNotifier host (D-067)');
  const { app, page } = await h.start();
  const a = await createNote(page, COMMON, 'Tray quit');
  await page.evaluate((n) => window.infinity.sticky.float({ noteId: n }), a);
  const sp = await stickyPage(app, a);
  await typeEnd(sp, 'tray unsaved');
  const proc = app.process();
  await app.evaluate(() => globalThis.__infinityTest!.tray!.click('Quit Infinity Notes'));
  expect(await waitForExit(proc, 20_000)).toBe(true);
  expect(readMainLog(h.userData)).toContain('flush: requested=2 acked=2 timedOut=0');
  expect(noteText(a)).toBe('tray unsaved');
});

test('first close asks; choice is remembered and editable (INF-DESK-01)', async () => {
  test.setTimeout(180_000);
  const { app, page } = await h.start();
  const caps = await page.evaluate(() => window.infinity.capabilities.get());
  if (!caps.ok) throw new Error('capabilities');

  // An empty answer queue is Cancel: the window stays.
  await closeWindowByUrl(app, '#/');
  await expect.poll(async () => (await closeDialogs(app)).length).toBe(1);
  const [asked] = await closeDialogs(app);
  expect(asked).toMatchObject({
    message: 'Keep Infinity Notes running in the background?',
    buttons: ['Keep running in background', 'Quit', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    checkboxLabel: 'Remember my choice',
    checkboxChecked: true,
  });
  const relaunchExpected = !WIN || caps.data.tray.status !== 'supported';
  expect(asked!.detail).toBe(
    relaunchExpected ? `Reminders and stickies only work while the app is running.\n\n${RELAUNCH}` : 'Reminders and stickies only work while the app is running.',
  );
  await page.waitForTimeout(300);
  expect((await windowsOf(app)).main).not.toBeNull();

  // Keep running without remembering: closed, alive, nothing stored; the next close asks again.
  await closeMainToBackground(app, false);
  expect(alive(app)).toBe(true);
  expect(h.setting('app.closeBehavior')).toBeUndefined();
  await secondLaunch();
  await (await mainPageOf(app)).waitForSelector('#app-shell[data-ready="true"]');
  await closeMainToBackground(app, true);
  expect(await closeDialogs(app)).toHaveLength(3);
  expect(h.setting('app.closeBehavior')).toEqual({ v: 1, value: 'background' });

  // Remembered: no dialog next time.
  await secondLaunch();
  const main = await mainPageOf(app);
  await main.waitForSelector('#app-shell[data-ready="true"]');
  await closeWindowByUrl(app, '#/');
  await expect.poll(async () => (await windowsOf(app)).main).toBeNull();
  expect(await closeDialogs(app)).toHaveLength(3);

  // Editable in Settings.
  await secondLaunch();
  const again = await mainPageOf(app);
  await again.waitForSelector('#app-shell[data-ready="true"]');
  await railGo(again, 'Settings');
  const group = again.getByRole('radiogroup', { name: 'When the main window closes' });
  await expect(group.getByRole('radio', { name: 'Keep running' })).toBeChecked();
  await activate(group.getByRole('radio', { name: 'Ask' }));
  await expect.poll(() => h.setting('app.closeBehavior')).toEqual({ v: 1, value: 'ask' });

  // Quit remembered: the process exits, and the next close quits without asking.
  const proc = app.process();
  await queueClose(app, 'quit', true);
  await closeWindowByUrl(app, '#/');
  expect(await waitForExit(proc, 20_000)).toBe(true);
  expect(h.setting('app.closeBehavior')).toEqual({ v: 1, value: 'quit' });
  const second = await h.start();
  const proc2 = second.app.process();
  await closeWindowByUrl(second.app, '#/');
  expect(await waitForExit(proc2, 20_000)).toBe(true);
  expect(readMainLog(h.userData)).toContain('flush: requested=1 acked=1 timedOut=0');
});

test('the close question names the relaunch path where no tray is supported (INF-DESK-01)', async () => {
  const { app } = await h.start(WIN ? { INFINITY_NOTES_TEST_CAPS: JSON.stringify({ tray: 'unsupported' }) } : {});
  await closeWindowByUrl(app, '#/');
  await expect.poll(async () => (await closeDialogs(app)).map((d) => d.detail)).toEqual([`Reminders and stickies only work while the app is running.\n\n${RELAUNCH}`]);
  await railGo(await mainPageOf(app), 'Settings');
  await expect((await mainPageOf(app)).getByText('No tray icon is available on this desktop. Launch Infinity Notes again to bring the main window back.')).toBeVisible();
});

test('tray menu (INF-DESK-02, Windows)', async () => {
  test.skip(!WIN, 'Windows always has a tray; on Linux the tray-less fallback below applies (D-067)');
  const { app, page } = await h.start();
  const tray = () => app.evaluate(() => ({ present: globalThis.__infinityTest!.tray!.present, items: globalThis.__infinityTest!.tray!.items() }));
  expect(await tray()).toEqual({ present: true, items: ['Open Infinity Notes', 'New sticky', 'Show widget', 'Quit Infinity Notes'] });
  expect(readMainLog(h.userData)).toContain('tray: created');

  await app.evaluate(() => globalThis.__infinityTest!.tray!.click('New sticky'));
  await expect.poll(() => h.all('SELECT id FROM notes').length).toBe(1);
  const created = h.one<{ id: string; project_id: string | null; folder_id: string | null; sticky_enabled: number; color: string }>(
    'SELECT id, project_id, folder_id, sticky_enabled, color FROM notes',
  )!;
  expect(created).toMatchObject({ project_id: null, folder_id: null, sticky_enabled: 1, color: 'yellow' });
  await stickyPage(app, created.id);
  expect(await stickyNoteIds(app)).toEqual([created.id]);
  expect(page.isClosed()).toBe(false);

  await closeMainToBackground(app);
  await app.evaluate(() => globalThis.__infinityTest!.tray!.click('Open Infinity Notes'));
  const main = await mainPageOf(app);
  await main.waitForSelector('#app-shell[data-ready="true"]');
  await expect.poll(async () => (await windowsOf(app)).main?.visible).toBe(true);

  // Show widget opens the reminder widget window (W05-03, D-067); a second click keeps one window.
  await app.evaluate(() => globalThis.__infinityTest!.tray!.click('Show widget'));
  await app.evaluate(() => globalThis.__infinityTest!.tray!.click('Show widget'));
  await expect.poll(() => app.windows().filter((p) => !p.isClosed() && p.url().endsWith('#/widget')).length).toBe(1);
  expect(await app.evaluate(() => globalThis.__infinityTest!.widget().then((w) => w !== null))).toBe(true);
  expect(h.one<{ open: number }>("SELECT open FROM window_state WHERE key = 'widget'")!.open).toBe(1);
  await main.evaluate(() => window.infinity.widget.hide());
  await expect.poll(() => app.evaluate(() => globalThis.__infinityTest!.widget())).toBeNull();

  const proc = app.process();
  await app.evaluate(() => globalThis.__infinityTest!.tray!.click('Quit Infinity Notes'));
  expect(await waitForExit(proc, 20_000)).toBe(true);
  expect(readMainLog(h.userData)).toMatch(/flush: requested=2 acked=2 timedOut=0/);
});

test('without a tray host a second launch brings the window back (INF-DESK-02)', async () => {
  const { app, page } = await h.start(WIN ? { INFINITY_NOTES_TEST_CAPS: JSON.stringify({ tray: 'unsupported' }) } : {});
  const caps = await page.evaluate(() => window.infinity.capabilities.get());
  expect(caps).toMatchObject({ ok: true, data: { tray: { status: 'unsupported', reason: WIN ? 'test-override' : 'no-status-notifier-host' } } });
  expect(await app.evaluate(() => globalThis.__infinityTest!.tray!.present)).toBe(false);
  expect(readMainLog(h.userData)).toMatch(/tray: not created reason=/);

  const id = await createNote(page, COMMON, 'Kept floating');
  await saveText(page, id, 'x');
  await page.evaluate((n) => window.infinity.sticky.float({ noteId: n }), id);
  await stickyPage(app, id);
  await closeMainToBackground(app);
  expect(await windowCount(app)).toBe(1);
  await secondLaunch();
  await (await mainPageOf(app)).waitForSelector('#app-shell[data-ready="true"]');
  expect(await windowCount(app)).toBe(2);

  await stickyMenu(await stickyPage(app, id), 'Hide');
  await expect.poll(() => windowCount(app)).toBe(1);
  await closeMainToBackground(app);
  expect(await windowCount(app)).toBe(0);
  expect(alive(app)).toBe(true);
  await secondLaunch();
  await (await mainPageOf(app)).waitForSelector('#app-shell[data-ready="true"]');
  expect(await windowCount(app)).toBe(1);
});

test('relaunch overdue summary: reminders stop when quit and recover at the next start (INF-SCHED-09, INF-SCHED-05)', async () => {
  const { page } = await h.start(reminderEnv({ notifications: true }));
  const id = await createNote(page, COMMON, 'Quit test');
  await createReminder(page, { noteId: id, title: 'While quit', zoneId: 'UTC', date: '2026-10-08', time: '07:10' });
  await h.stop();
  // Nothing was claimed while the app was not running.
  expect(h.all('SELECT id FROM alert_deliveries')).toEqual([]);
  const relaunchAt = Date.parse(T0) + 30 * 60_000;
  const second = await h.restart(reminderEnv({ clock: new Date(relaunchAt).toISOString(), notifications: true }));
  const banner = second.page.getByRole('status', { name: 'Reminder alerts' });
  await expect(banner).toContainText('1 reminder is overdue');
  await expect.poll(() => shownNotifications(second.app)).toHaveLength(1);
  expect(h.all<{ reason: string; claimed_at: number }>('SELECT reason, claimed_at FROM alert_deliveries')).toEqual([{ reason: 'startup', claimed_at: relaunchAt }]);
  await activate(banner.getByRole('button', { name: 'Show overdue' }));
  await expect.poll(() => activeTabLabel(second.page)).toBe('Reminders');
  await expect(second.page.getByRole('tab', { name: 'Overdue, 1' })).toHaveAttribute('aria-selected', 'true');
});
