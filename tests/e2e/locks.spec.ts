import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { useApp } from './harness';
import { dbFileOf } from './fixtures';
import { chooseNoteMenu, editor, editorText, focusEditorEnd, paletteAction, waitSaved } from './editor-ui';
import { COMMON, createNote, saveText } from './seed';
import { dialogByName, openFromTree, railGo, treeByKey } from './ui';

const h = useApp({ failOnMainErrors: true });

/** One search token and a phrase that exist only in the locked note. */
const MARKER = 'zebrasecretmarker';
const PASSWORD = 'correct horse battery';

const lockScreen = (page: Page) => page.locator('.lock-screen');
const lockMark = (page: Page, noteId: string) => treeByKey(page, `note:${noteId}`).getByRole('img', { name: 'Locked' });

async function lockNote(page: Page, title: string, opts: { hello?: boolean } = {}): Promise<void> {
  await chooseNoteMenu(page, 'Lock note…');
  const dialog = dialogByName(page, `Lock “${title}”`);
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Repeat password').fill(PASSWORD);
  if (opts.hello) await dialog.getByRole('checkbox', { name: /Also unlock with Windows Hello/ }).check();
  await dialog.getByRole('checkbox', { name: 'I understand a forgotten password cannot be recovered' }).check();
  await dialog.getByRole('button', { name: 'Lock note' }).click();
  await expect(dialog).toBeHidden();
  await expect(lockScreen(page)).toBeVisible();
}

async function unlock(page: Page, password = PASSWORD): Promise<void> {
  await lockScreen(page).getByPlaceholder('Password').fill(password);
  await lockScreen(page).getByRole('button', { name: 'Unlock' }).click();
}

/** The database file and its WAL as bytes (read while the app is closed, or as they are on disk now). */
function databaseBytes(userData: string): Buffer {
  const file = dbFileOf(userData);
  return Buffer.concat([file, `${file}-wal`].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f)));
}

test('lock with a password: the body leaves the tab, search, Home and history; edits stay encrypted across a restart (D-111, D-112)', async () => {
  const { page } = await h.start();
  const id = await createNote(page, COMMON, 'Bank');
  await saveText(page, id, `PIN ${MARKER} 4321`);
  await h.stop();
  // An earlier version and a recovered draft with the text: locking must destroy both.
  h.writeWhileClosed((db) => {
    const content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'text', text: `old ${MARKER}` }] }] });
    db.prepare("INSERT INTO note_versions(id, note_id, revision, format, content_snapshot, reason, created_at) VALUES (?, ?, 1, 'rich', ?, 'auto', ?)").run(randomUUID(), id, content, Date.now());
    db.prepare("INSERT INTO note_drafts(id, note_id, view_id, base_revision, format, content, reason, created_at) VALUES (?, ?, 'v', 0, 'rich', ?, 'conflict', ?)").run(randomUUID(), id, content, Date.now());
  });

  const { page: p } = await h.start();
  await openFromTree(p, id);
  await expect.poll(() => editorText(p)).toContain(MARKER);
  await lockNote(p, 'Bank');

  // The tab shows only the lock screen; the tree marks the note; the stored row and its history hold no text.
  await expect(lockScreen(p)).toContainText('Bank');
  await expect(editor(p)).toHaveCount(0);
  await expect(p.getByText(MARKER)).toHaveCount(0);
  await expect(lockMark(p, id)).toBeVisible();
  expect(h.one('SELECT locked, content_json, plain_text FROM notes WHERE id = ?', id)).toEqual({ locked: 1, content_json: null, plain_text: '' });
  expect(h.one('SELECT (SELECT count(*) FROM note_versions WHERE note_id = ?) AS versions, (SELECT count(*) FROM note_drafts WHERE note_id = ?) AS drafts', id, id)).toEqual({ versions: 0, drafts: 0 });
  expect(databaseBytes(h.userData).includes(Buffer.from(MARKER))).toBe(false);

  // Search finds the title only, never the body.
  const search = (query: string) => p.evaluate(async (q) => (await window.infinity.search.query({ query: q })) as { ok: boolean; data?: { results: unknown[] } }, query);
  expect(await search(MARKER)).toEqual({ ok: true, data: { results: [] } });
  await p.keyboard.press('Control+K');
  const palette = dialogByName(p, 'Command palette');
  const results = palette.getByRole('listbox', { name: 'Results' }).getByRole('option');
  await palette.getByRole('combobox', { name: 'Type a command or search notes' }).fill('Bank');
  await expect(results.filter({ hasText: 'Bank' })).toHaveCount(1);
  await expect(results.filter({ hasText: 'Bank' }).getByRole('img', { name: 'Locked' })).toBeVisible();
  await p.keyboard.press('Escape');

  // Home lists it by title, with the lock.
  await railGo(p, 'Home');
  const recent = p.locator('.recent-row').filter({ hasText: 'Bank' });
  await expect(recent.getByRole('img', { name: 'Locked' })).toBeVisible();
  await expect(p.locator('.home')).not.toContainText(MARKER);

  // A wrong password gets one generic message; the right one opens the note for editing.
  await recent.click();
  await unlock(p, 'not the password');
  await expect(lockScreen(p).getByRole('alert')).toHaveText('That password is not correct.');
  await unlock(p);
  await expect.poll(() => editorText(p)).toContain(MARKER);
  await focusEditorEnd(p);
  await p.keyboard.type(' edited');
  await waitSaved(p);
  await chooseNoteMenu(p, 'Version history…');
  await expect(dialogByName(p, 'Version history')).toContainText('Locked notes keep no version history');
  await p.keyboard.press('Escape');

  // On disk only ciphertext; after a restart the note is locked again and opens with the password.
  await h.stop();
  expect(databaseBytes(h.userData).includes(Buffer.from(MARKER))).toBe(false);
  expect(databaseBytes(h.userData).includes(Buffer.from('edited'))).toBe(false);
  const { page: third } = await h.start();
  await openFromTree(third, id);
  await expect(lockScreen(third)).toBeVisible();
  await unlock(third);
  await expect.poll(() => editorText(third)).toBe(`PIN ${MARKER} 4321 edited`);
});

test('Lock now, screen lock, Windows Hello (fake) and removing the lock (D-111, D-113)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Diary');
  await saveText(page, id, 'dear diary');
  await openFromTree(page, id);
  await expect.poll(() => editorText(page)).toBe('dear diary');
  await lockNote(page, 'Diary', { hello: true });
  // Setting up Windows Hello asked for it once (the injected fake; real Windows Hello is never called under test).
  expect(await app.evaluate(() => globalThis.__infinityTest!.hello.calls)).toBe(1);

  await lockScreen(page).getByRole('button', { name: 'Use Windows Hello' }).click();
  await expect.poll(() => editorText(page)).toBe('dear diary');
  await chooseNoteMenu(page, 'Lock now');
  await expect(lockScreen(page)).toBeVisible();

  await app.evaluate(() => globalThis.__infinityTest!.hello.answers.push('canceled'));
  await lockScreen(page).getByRole('button', { name: 'Use Windows Hello' }).click();
  await expect(lockScreen(page).getByRole('alert')).toHaveText('Windows Hello was canceled.');
  await unlock(page);
  await expect.poll(() => editorText(page)).toBe('dear diary');

  // The computer locks: every note locks again.
  await app.evaluate(() => globalThis.__infinityTest!.power.emit('lock-screen'));
  await expect(lockScreen(page)).toBeVisible();
  await unlock(page);
  await expect.poll(() => editorText(page)).toBe('dear diary');

  // "Lock all notes" from the palette.
  await paletteAction(page, 'Lock all notes');
  await expect(lockScreen(page)).toBeVisible();
  await unlock(page);
  await expect.poll(() => editorText(page)).toBe('dear diary');

  // Remove the lock: the text is stored and searchable again; the tree loses the lock.
  await chooseNoteMenu(page, 'Lock settings…');
  const settings = dialogByName(page, 'Lock settings for “Diary”');
  const remove = settings.locator('.lock-section').filter({ hasText: 'Remove lock' });
  await remove.getByLabel('Password').fill(PASSWORD);
  await remove.getByRole('button', { name: 'Remove lock' }).click();
  await expect(settings).toBeHidden();
  await expect(lockMark(page, id)).toHaveCount(0);
  await expect.poll(() => h.one('SELECT locked, plain_text FROM notes WHERE id = ?', id)).toEqual({ locked: 0, plain_text: 'dear diary' });
  await expect.poll(() => editorText(page)).toBe('dear diary');
});
