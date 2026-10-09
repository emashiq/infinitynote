import { expect, test } from '@playwright/test';
import { editorText, externalWrite, focusEditorEnd } from './editor-ui';
import { useApp } from './harness';
import { COMMON, createNote, reloadUi, saveText, trashNote } from './seed';
import { dialogByName, openFromTree, toasts } from './ui';

const h = useApp();

const CONFLICT = 'This note changed elsewhere. Your edits were kept as a recovered draft';
const drafts = (noteId: string) =>
  h.all<{ id: string; reason: string; content: string; resolved_at: number | null }>(
    'SELECT id, reason, content, resolved_at FROM note_drafts WHERE note_id = ? ORDER BY created_at, rowid',
    noteId,
  );
const noteRow = (id: string) => h.one<{ revision: number; plain_text: string }>('SELECT revision, plain_text FROM notes WHERE id = ?', id)!;

async function openSeeded(title: string, text: string) {
  const launched = await h.start();
  const id = await createNote(launched.page, COMMON, title);
  await saveText(launched.page, id, text);
  await reloadUi(launched.page);
  await openFromTree(launched.page, id);
  await expect.poll(() => editorText(launched.page)).toBe(text);
  return { ...launched, id };
}

test('stale save keeps a draft (INF-SAVE-03)', async () => {
  const { app, page, id } = await openSeeded('Stale', 'base');
  await focusEditorEnd(page);
  await page.keyboard.insertText(' typed');
  // Another writer changes the note before main saves the typing, without telling the app (D-103).
  await externalWrite(app, id, 'forced text', false);
  const banner = page.getByText(CONFLICT);
  await expect(banner).toBeVisible();
  await expect.poll(() => editorText(page)).toBe('forced text');
  const [draft] = drafts(id);
  expect(draft).toMatchObject({ reason: 'conflict', resolved_at: null });
  expect(draft!.content).toContain('base typed');

  await page.getByRole('button', { name: 'Compare' }).press('Enter');
  const compare = dialogByName(page, 'Compare recovered draft');
  await expect(compare.getByRole('region', { name: 'Current note' })).toContainText('forced text');
  await expect(compare.getByRole('region', { name: 'Recovered draft' })).toContainText('base typed');
  const revision = noteRow(id).revision;
  await compare.getByRole('button', { name: 'Restore draft' }).press('Enter');
  await expect.poll(() => editorText(page)).toBe('base typed');
  await expect(banner).toHaveCount(0);
  await expect.poll(() => noteRow(id).revision).toBe(revision + 1);
  const version = h.one<{ reason: string; content_snapshot: string }>("SELECT reason, content_snapshot FROM note_versions WHERE note_id = ? AND reason = 'conflict'", id)!;
  expect(version.content_snapshot).toContain('forced text');
  expect(drafts(id)[0]!.resolved_at).not.toBeNull();

  // A second conflict, dismissed this time: the editor keeps the current content.
  await focusEditorEnd(page);
  await page.keyboard.insertText(' again');
  await externalWrite(app, id, 'second forced', false);
  await expect(banner).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss' }).press('Enter');
  await expect(banner).toHaveCount(0);
  await expect.poll(() => drafts(id).every((d) => d.resolved_at !== null)).toBe(true);
  await expect.poll(() => editorText(page)).toBe('second forced');
  expect(drafts(id)).toHaveLength(2);
});

test('trashed while editing keeps a draft (F-02-1)', async () => {
  const { page, id } = await openSeeded('Shopping', 'milk');
  await focusEditorEnd(page);
  await page.keyboard.insertText(' more');
  await trashNote(page, id);
  await expect(toasts(page).filter({ hasText: 'Your unsaved edits to "Shopping" were kept as a recovered draft. Restore the note from Trash to see them.' })).toBeVisible();
  await expect.poll(() => drafts(id).length).toBe(1);
  expect(drafts(id)[0]).toMatchObject({ reason: 'conflict' });
  expect(drafts(id)[0]!.content).toContain('milk more');
});
