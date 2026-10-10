import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { useApp } from './harness';
import { dbFileOf } from './fixtures';
import { editor, editorText, paletteAction, waitSaved } from './editor-ui';
import { advance, reminderEnv } from './reminder-ui';
import { stickyPage } from './sticky-ui';
import { dialogByName } from './ui';

/**
 * Notes created locked and locked stickies (D-171..D-174). Written for the end-of-release run under Xvfb in WSL and on
 * CI; not run during implementation (no window may open on the Windows desktop).
 */
const h = useApp({ failOnMainErrors: true });

const PASSWORD = 'correct horse battery';
const PIN = '4821';
const MARKER = 'wombatsecretmarker';

const blurred = (page: Page) => page.getByTestId('sticky-locked');

/** Fills the dialog of "New locked note…" or "New locked sticky…" and creates it. */
async function createLocked(page: Page, kind: 'note' | 'sticky', pin?: string): Promise<void> {
  await paletteAction(page, kind === 'note' ? 'New locked note…' : 'New locked sticky…');
  const dialog = dialogByName(page, kind === 'note' ? 'New locked note' : 'New locked sticky');
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Repeat password').fill(PASSWORD);
  if (pin) {
    await dialog.getByLabel('PIN (4 to 8 digits)').fill(pin);
    await dialog.getByLabel('Repeat PIN').fill(pin);
  }
  await dialog.getByRole('checkbox', { name: 'I understand a forgotten password cannot be recovered' }).check();
  await dialog.getByRole('button', { name: kind === 'note' ? 'Create locked note' : 'Create locked sticky' }).click();
  await expect(dialog).toBeHidden();
}

function databaseBytes(userData: string): Buffer {
  const file = dbFileOf(userData);
  return Buffer.concat([file, `${file}-wal`].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f)));
}

test('a new locked note never stores its text in plaintext (D-171)', async () => {
  const { page } = await h.start();
  await createLocked(page, 'note');
  // It opens unlocked for this session, like a note just unlocked.
  await expect(editor(page)).toBeVisible();
  const row = h.all<{ id: string; locked: number; content_json: string | null; plain_text: string }>('SELECT id, locked, content_json, plain_text FROM notes')[0]!;
  expect(row).toMatchObject({ locked: 1, content_json: null, plain_text: '' });
  await editor(page).click();
  await page.keyboard.type(`Door code ${MARKER}`);
  await expect.poll(() => editorText(page)).toContain(MARKER);
  await waitSaved(page);
  await expect.poll(() => h.one<{ n: number }>('SELECT count(*) AS n FROM note_versions WHERE note_id = ?', row.id)?.n).toBe(0);
  expect(h.one('SELECT content_json, plain_text FROM notes WHERE id = ?', row.id)).toEqual({ content_json: null, plain_text: '' });
  expect(h.one<{ n: number }>('SELECT count(*) AS n FROM note_drafts WHERE note_id = ?', row.id)?.n).toBe(0);
  const search = await page.evaluate(async (q) => (await window.infinity.search.query({ query: q })) as { ok: boolean; data?: { results: unknown[]; documents: unknown[] } }, MARKER);
  expect(search).toEqual({ ok: true, data: { results: [], documents: [] } });
  await h.stop();
  expect(databaseBytes(h.userData).includes(Buffer.from(MARKER))).toBe(false);
});

test('a locked sticky: blur after a minute, PIN while the key is in memory, password after Lock now (D-172, D-173)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await createLocked(page, 'sticky');
  const id = h.all<{ id: string }>('SELECT id FROM notes WHERE sticky_enabled = 1')[0]!.id;
  const sticky = await stickyPage(app, id);
  // Created with the password just typed: shown at first. Type a secret.
  await expect(editor(sticky)).toBeVisible();
  await editor(sticky).click();
  await sticky.keyboard.type(MARKER);
  await expect.poll(() => editorText(sticky)).toContain(MARKER);

  // One minute without interaction (on the test clock): the text leaves the window.
  await advance(app, 61_000);
  await expect(blurred(sticky)).toBeVisible();
  await expect(editor(sticky)).toHaveCount(0);
  expect(await sticky.content()).not.toContain(MARKER);
  // The window cannot get the text by asking main itself.
  const direct = await sticky.evaluate(async (noteId) => window.infinity.note.open({ noteId }), id);
  expect(direct).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', details: { blurred: true } } });

  // No PIN yet: the password shows it again.
  await blurred(sticky).getByPlaceholder('Password').fill(PASSWORD);
  await blurred(sticky).getByRole('button', { name: 'Show' }).click();
  await expect.poll(() => editorText(sticky)).toContain(MARKER);

  // Set a PIN from the sticky menu.
  await sticky.getByRole('button', { name: 'Sticky actions' }).click();
  await sticky.getByRole('menuitem', { name: 'Set PIN…' }).click();
  const pinDialog = dialogByName(sticky, 'Set PIN');
  await pinDialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await pinDialog.getByLabel('PIN (4 to 8 digits)').fill(PIN);
  await pinDialog.getByLabel('Repeat PIN').fill(PIN);
  await pinDialog.getByRole('button', { name: 'Set PIN' }).click();
  await expect(pinDialog).toBeHidden();

  // Blurred again after a minute; the PIN shows it while the key is in memory.
  await advance(app, 61_000);
  await expect(blurred(sticky)).toBeVisible();
  await blurred(sticky).getByPlaceholder('PIN').fill(PIN);
  await blurred(sticky).getByRole('button', { name: 'Show' }).click();
  await expect.poll(() => editorText(sticky)).toContain(MARKER);

  // Interaction keeps it shown past the minute.
  await advance(app, 40_000);
  await editor(sticky).click();
  await advance(app, 40_000);
  await expect(editor(sticky)).toBeVisible();

  // Lock all (palette): the key leaves memory, the sticky blurs at once and the PIN is refused.
  await paletteAction(page, 'Lock all notes');
  await expect(blurred(sticky)).toBeVisible();
  await expect(blurred(sticky)).toContainText('password (or Windows Hello) is needed');
  await expect(blurred(sticky).getByPlaceholder('PIN')).toHaveCount(0);
  const pinNow = await sticky.evaluate(async ([noteId, pin]) => window.infinity.sticky.reveal({ noteId, with: { kind: 'pin', pin } }), [id, PIN] as const);
  expect(pinNow).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', details: { needsPassword: true } } });
  await blurred(sticky).getByPlaceholder('Password').fill(PASSWORD);
  await blurred(sticky).getByRole('button', { name: 'Show' }).click();
  await expect.poll(() => editorText(sticky)).toContain(MARKER);

  // The Stickies page lists it with a lock and no text.
  await paletteAction(page, 'Open Stickies');
  const row = page.locator('.sticky-row').filter({ has: page.getByRole('img', { name: 'Locked' }) });
  await expect(row).toHaveCount(1);
  await expect(page.locator('.sticky-list')).not.toContainText(MARKER);
});

test('five wrong PINs in a row need the password (D-173)', async () => {
  const { app, page } = await h.start(reminderEnv());
  await createLocked(page, 'sticky', PIN);
  const id = h.all<{ id: string }>('SELECT id FROM notes WHERE sticky_enabled = 1')[0]!.id;
  const sticky = await stickyPage(app, id);
  await sticky.getByRole('button', { name: 'Sticky actions' }).click();
  await sticky.getByRole('menuitem', { name: 'Blur now' }).click();
  await expect(blurred(sticky)).toBeVisible();
  for (const wrong of ['0000', '0001', '0002', '0003', '0004']) {
    await blurred(sticky).getByPlaceholder('PIN').fill(wrong);
    await blurred(sticky).getByRole('button', { name: 'Show' }).click();
    await expect(blurred(sticky).getByRole('alert')).toBeVisible();
    // The test clock moves past each wait.
    await advance(app, 30_000);
  }
  await expect(blurred(sticky)).toContainText('Too many wrong PINs');
  await expect(blurred(sticky).getByPlaceholder('PIN')).toHaveCount(0);
  await blurred(sticky).getByPlaceholder('Password').fill(PASSWORD);
  await blurred(sticky).getByRole('button', { name: 'Show' }).click();
  await expect(editor(sticky)).toBeVisible();
});
