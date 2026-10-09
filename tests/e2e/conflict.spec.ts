import { expect, test } from '@playwright/test';
import { editor, editorText, fakeView, focusEditorEnd, openFormatting, toolbar, waitSaved } from './editor-ui';
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
  // Another writer changes the note inside the 400 ms debounce, without telling this window.
  await fakeView.forceWrite(app, id, 'forced text', false);
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
  await fakeView.forceWrite(app, id, 'second forced', false);
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

test('read-only mirror and take control (INF-SAVE-04)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Shared');
  await reloadUi(page);
  expect(await fakeView.acquire(app, id)).toBe(true);
  await openFromTree(page, id);
  await expect(page.getByText('This note is being edited in another window')).toBeVisible();
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
  // Read-only text cannot be formatted: Alt+F10 shows no formatting toolbar (D-102).
  await openFormatting(page);
  await expect(toolbar(page)).toHaveCount(0);
  expect(await fakeView.save(app, id, 'from other')).toMatchObject({ ok: true });
  await expect.poll(() => editorText(page)).toBe('from other');

  await page.getByRole('button', { name: 'Take edit control' }).press('Enter');
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await expect(page.getByText('This note is being edited in another window')).toHaveCount(0);
  await focusEditorEnd(page);
  await page.keyboard.insertText(' and mine');
  await waitSaved(page);
  await expect.poll(() => noteRow(id).plain_text).toBe('from other and mine');
});

test('take from a busy holder: the window flushes, then turns read-only (INF-SAVE-04)', async () => {
  const { app, page, id } = await openSeeded('Busy', 'start');
  await focusEditorEnd(page);
  await page.keyboard.insertText(' typed before handing over');
  expect(await fakeView.take(app, id)).toBe(true);
  await expect(page.getByText('This note is being edited in another window')).toBeVisible();
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
  expect(noteRow(id).plain_text).toBe('start typed before handing over');
  expect(await fakeView.save(app, id, 'other now')).toMatchObject({ ok: true });
  await expect.poll(() => editorText(page)).toBe('other now');
});

test('silent holder times out; its late save becomes a lease-lost draft (INF-SAVE-04)', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Silent');
  await reloadUi(page);
  expect(await fakeView.acquire(app, id)).toBe(true);
  await fakeView.setReleaseBehavior(app, 'ignore');
  await openFromTree(page, id);
  await expect(page.getByText('This note is being edited in another window')).toBeVisible();
  const started = Date.now();
  await page.getByRole('button', { name: 'Take edit control' }).press('Enter');
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true', { timeout: 15_000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
  expect(await fakeView.save(app, id, 'too late')).toMatchObject({ ok: false, code: 'LEASE_REQUIRED', draftId: expect.any(String) });
  expect(drafts(id)).toEqual([expect.objectContaining({ reason: 'lease_lost', content: expect.stringContaining('too late') })]);
});
