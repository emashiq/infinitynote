import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { dbFileOf, packagedExe, readMainLog, rendererSandbox } from './fixtures';
import { useApp } from './harness';
import { stickyPage } from './sticky-ui';
import { activate, openFromTree, railGo } from './ui';

const h = useApp();

test.beforeEach(() => {
  test.skip(packagedExe === '', 'INFINITY_NOTES_PACKAGED_EXE is not set (run npm run test:e2e:packaged)');
});

test('packaged app starts, reports diagnostics and persists the theme @packaged', async () => {
  const { page } = await h.start();
  await expect(page.locator('h1')).toHaveText('Infinity Notes');
  const info = await page.evaluate(async () => {
    const r = await window.infinity.app.getInfo();
    return r.ok ? r.data : null;
  });
  expect(info?.isPackaged).toBe(true);
  expect(info?.sqlite).toMatchObject({ driver: 'better-sqlite3', fts5: true, json: true });
  expect(info?.schemaVersion).toBe(6);
  expect(info?.startup).toEqual({ status: 'ok' });

  await railGo(page, 'Settings');
  await activate(page.getByRole('radio', { name: 'Dark' }));
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const r = await window.infinity.settings.get({ keys: ['appearance.theme'] });
        return r.ok ? r.data.values['appearance.theme'] : null;
      }),
    )
    .toBe('dark');

  const restarted = await h.restart();
  await railGo(restarted.page, 'Settings');
  await expect(restarted.page.getByRole('radio', { name: 'Dark' })).toBeChecked();
});

test('packaged override honored and test hooks absent @packaged', async () => {
  const { app, page } = await h.start();
  const reported = await app.evaluate(({ app: a }) => a.getPath('userData'));
  expect(path.resolve(reported)).toBe(path.resolve(h.userData));
  expect(fs.existsSync(dbFileOf(h.userData))).toBe(true);
  expect(readMainLog(h.userData)).toContain('userDataOverride=on');
  expect(readMainLog(h.userData)).toContain('packaged=true');

  // INFINITY_NOTES_E2E=1 is set by the fixture; hooks must still be absent in a packaged build.
  expect(await app.evaluate(() => typeof globalThis.__infinityTest)).toBe('undefined');

  // Nothing named "data" next to the executable.
  expect(fs.existsSync(path.join(path.dirname(packagedExe), 'data'))).toBe(false);

  // Real packaged renderer: served from the asar through the custom scheme, in the OS sandbox.
  expect(page.url().startsWith('infinity-app://renderer/')).toBe(true);
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.webContents as unknown as { getLastWebPreferences(): { sandbox: boolean; contextIsolation: boolean } };
    return wc.getLastWebPreferences();
  });
  expect(prefs.sandbox).toBe(true);
  expect(prefs.contextIsolation).toBe(true);
  const sandbox = await rendererSandbox(app);
  console.log(`renderer sandbox: ${sandbox.evidence}`);
  expect(sandbox.osSandboxed, sandbox.evidence).toBe(true);
});

test('packaged sticky window is sandboxed and test seams are ignored @packaged', async () => {
  const { app, page } = await h.start({ INFINITY_NOTES_TEST_CAPS: JSON.stringify({ tray: 'unsupported', alwaysOnTop: 'unsupported' }) });
  const caps = await page.evaluate(async () => {
    const r = await window.infinity.capabilities.get();
    return r.ok ? r.data : null;
  });
  expect(JSON.stringify(caps)).not.toContain('test-override');
  expect(readMainLog(h.userData)).not.toContain('INFINITY_NOTES_TEST_CAPS');

  const id = await page.evaluate(async () => {
    const r = await window.infinity.note.create({ location: { projectId: null, folderId: null }, sticky: true, title: 'Packaged sticky' });
    return r.ok ? r.data.note.id : '';
  });
  expect(await page.evaluate((n) => window.infinity.sticky.float({ noteId: n }), id)).toMatchObject({ ok: true, data: { created: true } });
  const sticky = await stickyPage(app, id);
  expect(sticky.url()).toBe(`infinity-app://renderer/index.html#/sticky/${id}`);
  const prefs = await app.evaluate(({ BrowserWindow }, n) => {
    const wc = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(`#/sticky/${n}`))!.webContents as unknown as {
      getLastWebPreferences(): { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean };
    };
    return wc.getLastWebPreferences();
  }, id);
  expect(prefs).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
  const sandbox = await rendererSandbox(app, `#/sticky/${id}`);
  console.log(`packaged sticky renderer sandbox: ${sandbox.evidence}`);
  expect(sandbox.osSandboxed, sandbox.evidence).toBe(true);
  expect(await app.evaluate(() => typeof globalThis.__infinityTest)).toBe('undefined');
});

test('packaged reminder reaches the OS notification layer; reminder seams ignored; launch at login is only read @packaged', async () => {
  test.setTimeout(180_000);
  const { page } = await h.start({ INFINITY_NOTES_TEST_CLOCK: '2020-01-01T00:00:00Z', INFINITY_NOTES_TEST_ZONE: 'Pacific/Chatham', INFINITY_NOTES_TEST_NOTIFY: 'fake' });
  const zones = await page.evaluate(async () => {
    const r = await window.infinity.zones.list();
    return r.ok ? r.data : null;
  });
  // The real clock and the computer's zone, not the seams.
  expect(Math.abs(zones!.asOf - Date.now())).toBeLessThan(60_000);
  expect(zones!.systemZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const caps = await page.evaluate(async () => {
    const r = await window.infinity.capabilities.get();
    return r.ok ? r.data : null;
  });
  const autostart = await page.evaluate(async () => window.infinity.autostart.get());
  console.log(`packaged capabilities: notifications=${JSON.stringify(caps!.nativeNotifications)} autostart=${JSON.stringify(autostart)}`);
  if (process.platform === 'win32') {
    expect(autostart).toEqual({ ok: true, data: { enabled: false, capability: { status: 'supported', reason: 'login-items' } } });
  } else {
    expect(autostart).toMatchObject({ ok: true, data: { enabled: false, capability: { status: 'unsupported' } } });
  }

  // A reminder due at the next whole minute (UTC), dispatched by the real scheduler and adapter.
  const due = new Date(Math.ceil((Date.now() + 5_000) / 60_000) * 60_000);
  const iso = due.toISOString();
  const id = await page.evaluate(async () => {
    const r = await window.infinity.note.create({ location: { projectId: null, folderId: null }, sticky: false, title: 'Packaged reminder' });
    return r.ok ? r.data.note.id : '';
  });
  const created = await page.evaluate(
    ([noteId, date, time]) => window.infinity.reminder.create({ noteId: noteId!, blockId: null, title: 'Packaged reminder', zoneId: 'UTC', date: date!, time: time!, recurrence: null, followup: null }),
    [id, iso.slice(0, 10), iso.slice(11, 16)],
  );
  expect(created.ok).toBe(true);
  await expect
    .poll(() => h.all("SELECT outcome FROM alert_deliveries WHERE outcome <> 'claimed'"), { timeout: 90_000, intervals: [1_000] })
    .toHaveLength(1);
  const [delivery] = h.all<{ outcome: string; detail: string | null }>('SELECT outcome, detail FROM alert_deliveries');
  console.log(`packaged delivery: ${JSON.stringify(delivery)}`);
  if (caps!.nativeNotifications.status === 'unsupported') expect(delivery).toEqual({ outcome: 'unsupported', detail: caps!.nativeNotifications.reason });
  else expect(delivery!.outcome).toBe('dispatched');
});

test('packaged build suggests a reminder from text @packaged', async () => {
  // The real clock and zone (the test seams are ignored in packaged builds), so no date is asserted: this proves the
  // English chrono parser is bundled and runs in the packaged renderer (plan section 12.4).
  const { page } = await h.start();
  const id = await page.evaluate(async () => {
    const r = await window.infinity.note.create({ location: { projectId: null, folderId: null }, sticky: false, title: 'Rent' });
    return r.ok ? r.data.note.id : '';
  });
  await openFromTree(page, id);
  const editor = page.getByRole('textbox', { name: 'Note text', exact: true });
  await expect(editor).toHaveAttribute('aria-readonly', 'false');
  await editor.click();
  await page.keyboard.type('Pay rent tomorrow');
  await expect(page.locator('.nlp-candidate')).toHaveText(['tomorrow'], { timeout: 5_000 });
  const more = page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'More', exact: true });
  await more.focus();
  await more.press('Enter');
  const item = page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: 'Create reminder from text', exact: true });
  await item.focus();
  await item.press('Enter');
  const card = page.getByRole('dialog', { name: 'Create reminder' });
  await expect(card.getByRole('heading', { name: 'Create reminder' })).toBeVisible();
  await expect(card.locator('.date-line')).toHaveText(/^\w+day, \d{1,2} \w+ \d{4}$/);
  await activate(card.getByRole('button', { name: 'Cancel' }));
  await expect(card).toHaveCount(0);
  expect(h.one<{ n: number }>('SELECT count(*) AS n FROM reminders')?.n).toBe(0);
});
