import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { makeNoisePng } from '../support/png';
import { closeApp, dbFileOf, launchApp, openDb, readMainLog, rendererSandbox } from '../e2e/fixtures';
import { editor } from '../e2e/editor-ui';
import { importImage } from '../e2e/seed';
import { titleInput } from '../e2e/ui';

/**
 * One step of the installed-build check (INF-PKG-01, INF-PKG-03, INF-PKG-04). The installed executable comes from
 * INFINITY_NOTES_PACKAGED_EXE, the data from INFINITY_INSTALL_USERDATA, which outlives the test (never the user's own
 * profile). `create` writes a note with an image; `verify` relaunches and finds the same data.
 */
const step = process.env.INFINITY_INSTALL_STEP ?? '';
const userDataDir = process.env.INFINITY_INSTALL_USERDATA ?? '';
const exe = process.env.INFINITY_NOTES_PACKAGED_EXE ?? '';
const TITLE = 'Installed check';
const BODY = 'Written by the installed app বাংলা';
const IMAGE = makeNoisePng(64, 48, 99);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test.beforeEach(() => {
  test.skip(!step || !userDataDir || !exe, 'run through tools/verify-windows-install.mjs');
});

test('installed app: create data', async () => {
  test.skip(step !== 'create');
  const { app, page } = await launchApp({ userDataDir });
  try {
    await expectInstalledExecutable(app);
    await page.keyboard.press('Control+N');
    await expect(titleInput(page)).toBeFocused();
    await page.keyboard.type(TITLE);
    await page.keyboard.press('Enter');
    await page.keyboard.type(BODY);
    await expect(editor(page)).toContainText(BODY);
    const image = await importImage(page, IMAGE, 'installed.png');
    expect(image.width).toBe(64);
    await expect.poll(() => readNotes()).toEqual([{ title: TITLE, plain_text: BODY }]);
  } finally {
    await closeApp(app);
  }
});

test('installed app: relaunch finds the data', async () => {
  test.skip(step !== 'verify');
  const { app, page } = await launchApp({ userDataDir });
  try {
    await expectInstalledExecutable(app);
    const sandbox = await rendererSandbox(app);
    console.log(`installed renderer sandbox: ${sandbox.evidence}`);
    expect(sandbox.osSandboxed, sandbox.evidence).toBe(true);
    const info = await page.evaluate(async () => {
      const r = await window.infinity.app.getInfo();
      return r.ok ? r.data : null;
    });
    expect(info).toMatchObject({ isPackaged: true, startup: { status: 'ok' }, sqlite: { driver: 'better-sqlite3', fts5: true } });
    expect(readNotes()).toEqual([{ title: TITLE, plain_text: BODY }]);
    const attachment = withDb((db) => db.prepare('SELECT managed_relative_path AS p, sha256 FROM attachments').get() as { p: string; sha256: string });
    expect(attachment.sha256).toBe(sha(IMAGE));
    expect(sha(fs.readFileSync(path.join(userDataDir, 'data', attachment.p)))).toBe(sha(IMAGE));
    const search = await page.evaluate(() => window.infinity.search.query({ query: 'বাংলা' }));
    expect(search.ok && search.data.results.map((r) => r.note.title)).toEqual([TITLE]);
    // One real notification from the installed executable: on Windows this registers its toast activator, which the
    // uninstaller must remove again (N-D3, checked by tools/verify-windows-install.mjs).
    const shown = await app.evaluate(
      ({ Notification }) =>
        new Promise<string>((resolve) => {
          const n = new Notification({ title: 'Infinity Notes install check', body: 'Shown by the installed-build check.', silent: true });
          n.on('show', () => resolve('show'));
          n.on('failed', (_e, error) => resolve(`failed: ${error}`));
          n.show();
          setTimeout(() => resolve('no event'), 10_000);
        }),
    );
    console.log(`installed notification: ${shown}`);
    if (process.platform === 'win32') expect(shown).toBe('show');
    console.log(`installed relaunch ok: ${readMainLog(userDataDir).match(/startup app=[^\n]*/g)?.at(-1) ?? ''}`);
  } finally {
    await closeApp(app);
  }
});

/** The app runs from the installed files; an AppImage runs from its own mount point instead. */
async function expectInstalledExecutable(app: ElectronApplication): Promise<void> {
  const execPath = await app.evaluate(() => process.execPath);
  if (exe.endsWith('.AppImage')) expect(execPath).toMatch(/\/\.mount_[^/]+\/infinity-notes$/);
  else expect(path.resolve(execPath)).toBe(path.resolve(exe));
}

function withDb<T>(read: (db: ReturnType<typeof openDb>) => T): T {
  const db = openDb(dbFileOf(userDataDir), { readonly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

function readNotes(): Array<{ title: string; plain_text: string }> {
  return withDb((db) => db.prepare('SELECT title, plain_text FROM notes WHERE deleted_at IS NULL').all() as Array<{ title: string; plain_text: string }>);
}
