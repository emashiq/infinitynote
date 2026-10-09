import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { craftZip } from '../support/zip';
import { makePng } from '../support/png';
import { closeApp, dbFileOf, launchApp, makeUserDataDir, openDb, removeDir, type Launched } from './fixtures';
import { useApp } from './harness';
import { editor, focusEditorEnd, queueDialog, waitSaved } from './editor-ui';
import { createReminder } from './reminder-ui';
import { COMMON, createNote, importImage, reloadUi, saveDoc } from './seed';
import { chooseAppMenu, pathDialogs, pressButton, queueSave, settingsSection, tempFolder, waitForAppExit } from './portability-ui';
import { dialogByName, openFromTree, railGo, toasts, treeItem } from './ui';

const h = useApp({ failOnMainErrors: true });
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const para = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });

const SNAPSHOT = {
  notes: 'SELECT id, title, format, content_json, plain_text, revision FROM notes ORDER BY id',
  references: 'SELECT source_note_id, target_note_id, target_block_id FROM note_references ORDER BY source_note_id',
  reminders: 'SELECT id, note_id, block_id, title, zone_id, start_local_date, local_time FROM reminders ORDER BY id',
  occurrences: 'SELECT id, reminder_id, due_at_utc, state FROM occurrences ORDER BY id',
  attachments: 'SELECT id, managed_relative_path, sha256 FROM attachments ORDER BY id',
} as const;

function snapshot(userData: string): Record<string, unknown[]> {
  const db = openDb(dbFileOf(userData), { readonly: true });
  try {
    return Object.fromEntries(Object.entries(SNAPSHOT).map(([k, sql]) => [k, db.prepare(sql).all()]));
  } finally {
    db.close();
  }
}

let files = '';
test.beforeEach(() => {
  files = tempFolder();
});
test.afterEach(async () => {
  await removeDir(files);
});

test('back up an edited note with images while SQLite uses WAL, then restore it into a clean profile', async () => {
  const { app, page } = await h.start();
  const png = makePng(12, 8, [20, 140, 90, 255]);
  const image = await importImage(page, png, 'chart.png');
  const target = await createNote(page, COMMON, 'Target');
  const targetBlock = randomUUID();
  await saveDoc(page, target, { type: 'doc', content: [para(targetBlock, 'Target paragraph')] });
  const launch = await createNote(page, COMMON, 'Launch');
  const block = randomUUID();
  await saveDoc(page, launch, {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { id: randomUUID() }, content: [{ type: 'noteRef', attrs: { noteId: target, blockId: targetBlock, label: 'Target', excerpt: null } }] },
      { type: 'image', attrs: { id: randomUUID(), attachmentId: image.id, alt: 'chart', size: 'medium' } },
      para(block, 'Ship it'),
    ],
  });
  await createReminder(page, { noteId: launch, blockId: block, title: 'Ship it', date: '2030-01-02', time: '09:00' });
  // The last edit goes through the editor, like a user typing just before the backup.
  await reloadUi(page);
  await openFromTree(page, launch);
  await focusEditorEnd(page);
  await page.keyboard.type(' today');
  await waitSaved(page);
  expect(fs.statSync(`${dbFileOf(h.userData)}-wal`).size).toBeGreaterThan(0);

  const file = path.join(files, 'notebook.infinitybackup');
  await queueSave(app, file);
  await chooseAppMenu(page, 'File', 'Back up now…');
  await expect(toasts(page).filter({ hasText: 'Backup saved: notebook.infinitybackup' })).toBeVisible();
  expect((await pathDialogs(app)).at(-1)).toMatchObject({ kind: 'save', title: 'Back up Infinity Notes' });
  const expected = snapshot(h.userData);
  expect(JSON.stringify(expected.notes)).toContain('Ship it today');

  const clean = makeUserDataDir();
  let b: Launched | null = null;
  try {
    b = await launchApp({ userDataDir: clean });
    await railGo(b.page, 'Settings');
    await queueDialog(b.app, [file]);
    await pressButton(settingsSection(b.page, 'Backup'), 'Restore from backup…');
    const confirm = dialogByName(b.page, 'Restore from backup?');
    await expect(confirm).toContainText('It has 2 notes and 1 attachment.');
    await pressButton(confirm, 'Restore and restart');
    await waitForAppExit(b.app);
    await closeApp(b.app);

    b = await launchApp({ userDataDir: clean });
    await expect(toasts(b.page).filter({ hasText: 'Your notebook was restored from the backup.' })).toBeVisible();
    expect(snapshot(clean)).toEqual(expected);
    const stored = (expected.attachments![0] as { managed_relative_path: string }).managed_relative_path;
    expect(sha(fs.readFileSync(path.join(clean, 'data', stored)))).toBe(sha(png));
    await openFromTree(b.page, launch);
    await expect(editor(b.page)).toContainText('Ship it today');
    await expect.poll(() => editor(b!.page).getByRole('img', { name: 'chart' }).evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(12);
    await expect(b.page.locator('.note-ref').filter({ hasText: 'Target' })).toBeVisible();
    // The replaced data is kept until the user deletes it.
    await railGo(b.page, 'Settings');
    const backup = settingsSection(b.page, 'Backup');
    await expect(backup).toContainText('A copy of the data replaced by the restore');
    await pressButton(backup, 'Delete previous data');
    await expect(backup).not.toContainText('A copy of the data replaced by the restore');
  } finally {
    await closeApp(b?.app);
    await removeDir(clean);
  }
});

test('a malicious archive is refused before anything changes and the notebook stays usable', async () => {
  const { app, page } = await h.start();
  await createNote(page, COMMON, 'Keep me');
  await reloadUi(page);
  const evil = path.join(files, 'evil.infinitybackup');
  fs.writeFileSync(evil, craftZip([{ name: 'manifest.json', data: Buffer.from('{}') }, { name: '../../outside.txt', data: Buffer.from('x') }]));
  await railGo(page, 'Settings');
  await queueDialog(app, [evil]);
  await pressButton(settingsSection(page, 'Backup'), 'Restore from backup…');
  await expect(toasts(page).filter({ hasText: 'This file was refused because it contains unsafe or unexpected entries.' })).toBeVisible();
  await expect(dialogByName(page, 'Restore from backup?')).toHaveCount(0);
  expect(fs.existsSync(path.join(files, '..', '..', 'outside.txt'))).toBe(false);
  expect(fs.existsSync(path.join(h.userData, 'data', 'restore-staging'))).toBe(false);
  await page.keyboard.press('Control+N');
  await expect.poll(() => h.all('SELECT title FROM notes').length).toBe(2);
});

test('export a note as Markdown and plain text, export everything and import it as a copy', async () => {
  const { app, page } = await h.start();
  const note = await createNote(page, COMMON, 'Plan');
  await saveDoc(page, note, { type: 'doc', content: [{ type: 'heading', attrs: { id: randomUUID(), level: 2 }, content: [{ type: 'text', text: 'Goals' }] }, para(randomUUID(), 'Write tests')] });
  await reloadUi(page);
  await openFromTree(page, note);
  await queueSave(app, path.join(files, 'Plan.md'));
  await chooseAppMenu(page, 'File', 'Export note as Markdown…');
  await expect(toasts(page).filter({ hasText: 'Exported to Plan.md' })).toBeVisible();
  expect(fs.readFileSync(path.join(files, 'Plan.md'), 'utf8')).toBe('# Plan\n\n## Goals\n\nWrite tests\n');
  await queueSave(app, path.join(files, 'Plan.txt'));
  await chooseAppMenu(page, 'File', 'Export note as plain text…');
  await expect.poll(() => fs.existsSync(path.join(files, 'Plan.txt'))).toBe(true);
  expect(fs.readFileSync(path.join(files, 'Plan.txt'), 'utf8')).toBe('Plan\n\nGoals\nWrite tests');

  const exported = path.join(files, 'all.infinityexport');
  await queueSave(app, exported);
  await chooseAppMenu(page, 'File', 'Export all notes…');
  await expect(toasts(page).filter({ hasText: 'Exported 1 note to all.infinityexport' })).toBeVisible();
  await queueDialog(app, [exported]);
  await chooseAppMenu(page, 'File', 'Import notes…');
  await expect(toasts(page).filter({ hasText: /^Imported 1 note into “Imported \d{4}-\d{2}-\d{2} \d{2}:\d{2}”/ })).toBeVisible();
  const folder = h.one<{ name: string }>("SELECT name FROM folders WHERE name LIKE 'Imported %'")!.name;
  await expect(treeItem(page, folder)).toBeVisible();
  const rows = h.all<{ id: string; title: string }>("SELECT id, title FROM notes WHERE title = 'Plan'");
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.id)).toContain(note);
});

test('automatic backup is off by default; switched on it asks for a folder and writes there', async () => {
  const { app, page } = await h.start();
  await createNote(page, COMMON, 'Auto');
  await railGo(page, 'Settings');
  const backup = settingsSection(page, 'Backup');
  const autoSwitch = backup.getByRole('switch', { name: 'Back up automatically' });
  await expect(autoSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(backup).toContainText('No folder chosen');
  await queueDialog(app, [files]);
  await autoSwitch.focus();
  await autoSwitch.press('Space');
  await expect(autoSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(backup).toContainText(files);
  await app.evaluate(() => globalThis.__infinityTest!.autoBackup());
  await expect.poll(() => fs.readdirSync(files).filter((n) => /^Infinity Notes auto .*\.infinitybackup$/.test(n)).length).toBe(1);
  await reloadUi(page);
  await expect(settingsSection(page, 'Backup')).toContainText('Last automatic backup:');
});
