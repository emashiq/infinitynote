import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { useApp } from './harness';
import { reminderEnv } from './reminder-ui';
import { COMMON, createNote, reloadUi } from './seed';
import { pressButton, settingsSection } from './portability-ui';
import { activate, dialogByName, railGo } from './ui';

const h = useApp({ failOnMainErrors: true });

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const shortcuts = (app: ElectronApplication) => app.evaluate(() => [...globalThis.__infinityTest!.globalShortcut.registered]);

test('theme: System by default, Light and Dark apply at once and survive a restart (INF-PREF-01)', async () => {
  const { page } = await h.start();
  await railGo(page, 'Settings');
  const appearance = settingsSection(page, 'Appearance');
  await expect(appearance.getByRole('radio', { name: 'System' })).toBeChecked();
  await activate(appearance.getByRole('radio', { name: 'Dark' }));
  await expect.poll(() => theme(page)).toBe('dark');
  await activate(appearance.getByRole('radio', { name: 'Light' }));
  await expect.poll(() => theme(page)).toBe('light');
  await activate(appearance.getByRole('radio', { name: 'Dark' }));
  await expect.poll(() => h.setting('appearance.theme')).toEqual({ v: 1, value: 'dark' });
  const again = await h.restart();
  await expect.poll(() => theme(again.page)).toBe('dark');
});

test('reminder defaults: computer zone, end of day 17:00, date-only 09:00, follow-ups off; changes persist (INF-PREF-02)', async () => {
  const { page } = await h.start(reminderEnv());
  await railGo(page, 'Settings');
  const reminders = settingsSection(page, 'Reminders');
  await expect(reminders.getByLabel('Default time zone for new reminders')).toHaveValue('');
  await expect(reminders.getByRole('option', { name: 'Computer time zone (Asia/Dhaka)' })).toHaveCount(1);
  await expect(reminders.getByLabel('End of day')).toHaveValue('17:00');
  await expect(reminders.getByLabel('Time for date-only phrases')).toHaveValue('09:00');
  await expect(reminders.getByRole('switch', { name: 'Follow up on new reminders' })).toHaveAttribute('aria-checked', 'false');
  await expect(reminders.getByRole('switch', { name: 'Suggest reminders from dates in notes' })).toHaveAttribute('aria-checked', 'true');
  await reminders.getByLabel('End of day').fill('18:30');
  await reminders.getByLabel('Default time zone for new reminders').selectOption('UTC');
  await expect.poll(() => h.setting('reminders.endOfDayTime')).toEqual({ v: 1, value: '18:30' });
  await expect.poll(() => h.setting('reminders.defaultZone')).toEqual({ v: 1, value: 'UTC' });
  await reloadUi(page);
  await expect(settingsSection(page, 'Reminders').getByLabel('End of day')).toHaveValue('18:30');
});

test('quiet hours: off by default; on, they keep a zone and the chosen times (INF-PREF-03)', async () => {
  const { page } = await h.start(reminderEnv());
  await railGo(page, 'Settings');
  const reminders = settingsSection(page, 'Reminders');
  const quiet = reminders.getByRole('switch', { name: 'Quiet hours' });
  await expect(quiet).toHaveAttribute('aria-checked', 'false');
  await expect(reminders.getByLabel('From', { exact: true })).toHaveCount(0);
  await activate(quiet);
  await reminders.getByLabel('From', { exact: true }).fill('21:15');
  await reminders.getByLabel('To', { exact: true }).fill('06:45');
  await expect.poll(() => h.setting('reminders.quietHours')).toEqual({ v: 1, value: { enabled: true, start: '21:15', end: '06:45', zoneId: 'Asia/Dhaka' } });
  await reloadUi(page);
  await expect(settingsSection(page, 'Reminders').getByLabel('To', { exact: true })).toHaveValue('06:45');
});

test('lifecycle settings: close, tray, widget, startup and restore-stickies with the fully-quit explanation (INF-PREF-04, INF-DESK-03)', async () => {
  const { page } = await h.start();
  await railGo(page, 'Settings');
  const windows = settingsSection(page, 'Windows and tray');
  await expect(windows.getByRole('radio', { name: 'Ask' })).toBeChecked();
  await expect(windows.getByText('Reminders and stickies only work while the app is running.')).toBeVisible();
  await expect(settingsSection(page, 'Reminders').getByText(/^Reminders only fire while Infinity Notes is running/)).toBeVisible();
  for (const name of ['Restore open stickies on startup', 'Show reminder widget', 'Start Infinity Notes when you sign in']) {
    await expect(windows.getByRole('switch', { name }), name).toHaveAttribute('aria-checked', 'false');
  }
  const startup = windows.getByRole('switch', { name: 'Start Infinity Notes when you sign in' });
  await expect(startup).toBeDisabled();
  await expect(startup).toHaveAttribute('title', 'Available in the installed app');
  await activate(windows.getByRole('radio', { name: 'Keep running' }));
  await activate(windows.getByRole('switch', { name: 'Restore open stickies on startup' }));
  await expect.poll(() => h.setting('app.closeBehavior')).toEqual({ v: 1, value: 'background' });
  await expect.poll(() => h.setting('stickies.restoreOnStartup')).toEqual({ v: 1, value: true });
  // Optional features stay off until chosen: automatic backup and the global shortcut.
  await expect(settingsSection(page, 'Backup').getByRole('switch', { name: 'Back up automatically' })).toHaveAttribute('aria-checked', 'false');
  await expect(settingsSection(page, 'Keyboard').getByRole('switch', { name: /^Quick sticky from anywhere/ })).toHaveAttribute('aria-checked', 'false');
  const again = await h.restart();
  await railGo(again.page, 'Settings');
  await expect(settingsSection(again.page, 'Windows and tray').getByRole('radio', { name: 'Keep running' })).toBeChecked();
});

test('notes and attachments: size limits within bounds and retention choices persist (INF-PREF-05, INF-PORT-07)', async () => {
  const { page } = await h.start();
  await railGo(page, 'Settings');
  const notes = settingsSection(page, 'Notes and attachments');
  const image = notes.getByLabel('Largest image');
  await expect(image).toHaveValue('20');
  await expect(notes.getByLabel('Largest file')).toHaveValue('50');
  await image.fill('0');
  await image.press('Enter');
  await expect(notes.getByRole('alert')).toHaveText('Enter a whole number from 1 to 100.');
  expect(h.setting('attachments.imageMaxMb')).toBeUndefined();
  await image.fill('5');
  await image.press('Enter');
  await expect(notes.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => h.setting('attachments.imageMaxMb')).toEqual({ v: 1, value: 5 });
  await expect(notes.getByLabel('Empty Trash automatically')).toHaveValue('never');
  await notes.getByLabel('Empty Trash automatically').selectOption('30');
  await expect.poll(() => h.setting('retention.trashDays')).toEqual({ v: 1, value: 30 });
  const days = notes.getByLabel('Keep automatic versions for');
  await expect(days).toHaveValue('30');
  await days.fill('7');
  await days.blur();
  await expect.poll(() => h.setting('retention.autoVersionDays')).toEqual({ v: 1, value: 7 });
});

test('keyboard help: Ctrl+/ lists the shortcuts by area and gives focus back (INF-KEY-06)', async () => {
  const { page } = await h.start();
  await railGo(page, 'Settings');
  const show = settingsSection(page, 'Keyboard').getByRole('button', { name: 'Show keyboard shortcuts' });
  await show.focus();
  await page.keyboard.press('Control+/');
  const help = dialogByName(page, 'Keyboard shortcuts');
  await expect(help).toBeVisible();
  for (const caption of ['App', 'Notes tree', 'Editor', 'Sticky windows']) await expect(help.locator('caption', { hasText: caption })).toHaveCount(1);
  for (const [keys, action] of [
    ['Ctrl+N', 'New note'],
    ['Ctrl+K', 'Search notes and commands'],
    ['Ctrl+/', 'Keyboard shortcuts'],
    ['F2', 'Rename'],
    ['Ctrl+B', 'Bold'],
  ]) {
    await expect(help.getByRole('row', { name: `${keys} ${action}` }).first()).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(show).toBeFocused();
  await activate(show);
  await expect(dialogByName(page, 'Keyboard shortcuts')).toBeVisible();
  await pressButton(dialogByName(page, 'Keyboard shortcuts'), 'Close');
  await expect(show).toBeFocused();
});

test('global quick-sticky shortcut: off by default, registered when switched on, a held shortcut is reported (INF-KEY-05)', async () => {
  const { app, page } = await h.start();
  await createNote(page, COMMON, 'Existing');
  await railGo(page, 'Settings');
  const keyboard = settingsSection(page, 'Keyboard');
  expect(await shortcuts(app)).toEqual([]);
  await activate(keyboard.getByRole('switch', { name: 'Quick sticky from anywhere (Ctrl+Alt+N)' }));
  await expect.poll(() => shortcuts(app)).toEqual(['CommandOrControl+Alt+N']);
  await app.evaluate(() => globalThis.__infinityTest!.globalShortcut.press('CommandOrControl+Alt+N'));
  await expect.poll(() => h.all('SELECT id FROM notes WHERE sticky_enabled = 1').length).toBe(1);
  await expect.poll(async () => (await app.evaluate(() => globalThis.__infinityTest!.windows())).stickies.length).toBe(1);

  await app.evaluate(() => globalThis.__infinityTest!.globalShortcut.refuse.push('CommandOrControl+Alt+Space'));
  await keyboard.getByLabel('Shortcut').selectOption('CommandOrControl+Alt+Space');
  await expect(keyboard.getByRole('alert')).toHaveText('This shortcut is used by another app. Choose another one.');
  await expect(keyboard.getByRole('switch', { name: 'Quick sticky from anywhere (Ctrl+Alt+Space)' })).toHaveAttribute('aria-checked', 'false');
  expect(await shortcuts(app)).toEqual([]);
});

test('global shortcut is unavailable where the desktop does not support it', async () => {
  const { page } = await h.start({ INFINITY_NOTES_TEST_CAPS: JSON.stringify({ globalShortcut: 'unsupported' }) });
  await railGo(page, 'Settings');
  const keyboard = settingsSection(page, 'Keyboard');
  const toggle = keyboard.getByRole('switch', { name: /^Quick sticky from anywhere/ });
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute('title', 'Not supported by this desktop');
  await expect(keyboard).toContainText('This desktop does not let apps use global shortcuts.');
});
