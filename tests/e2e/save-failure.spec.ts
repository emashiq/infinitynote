import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readMainLog, waitForExit } from './fixtures';
import { useApp } from './harness';
import { COMMON, createNote, reloadUi, saveText } from './seed';
import { openFromTree, tabs } from './ui';
import { editor, editorText, setHook } from './editor-ui';
import { closeWindowByUrl, queueClose, stickyMenu, stickyNoteIds, stickyPage, windowsOf } from './sticky-ui';

/**
 * QA-1 (Phase 04 repair 1, D-055, D-072): a window is never closed while its last save failed and main kept no draft.
 * `failSaves` makes the next N `note:save` calls fail with INTERNAL; the renderer retries 3 times, 1 s apart.
 */
const h = useApp({ failOnMainErrors: true });

const KEPT = 'Could not save this note. The window stays open.';
const QUIT_CANCELED = 'Could not save this note, so Infinity Notes did not quit. Quit again to quit without saving it.';
const PERSISTENT = 100;
const TRANSIENT = 3;

const text = (id: string) => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', id)!.plain_text;
const stickyFlag = (id: string) => h.one<{ sticky_enabled: number }>('SELECT sticky_enabled FROM notes WHERE id = ?', id)!.sticky_enabled;
const draftCount = () => h.all('SELECT id FROM note_drafts').length;

async function typeEnd(page: Page, t: string): Promise<void> {
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'false');
  await editor(page).focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(t);
}

async function floated(app: ElectronApplication, page: Page, title: string): Promise<{ id: string; sp: Page }> {
  const id = await createNote(page, COMMON, title);
  await saveText(page, id, 'safe');
  await page.evaluate((n) => window.infinity.sticky.float({ noteId: n }), id);
  const sp = await stickyPage(app, id);
  await expect(editor(sp)).toHaveText('safe');
  return { id, sp };
}

const notice = (page: Page, message: string) => page.locator('.toast').filter({ hasText: message });

test('a sticky whose save keeps failing stays open on Hide, Open in app, Remove and the OS close', async () => {
  test.setTimeout(120_000);
  const { app, page } = await h.start();
  const { id, sp } = await floated(app, page, 'Failing');
  const tabsBefore = await tabs(page).count();
  await setHook(app, 'failSaves', PERSISTENT);
  await typeEnd(sp, ' TYPED');

  for (const action of ['Hide', 'Open in app', 'Remove from stickies']) {
    await stickyMenu(sp, action);
    await expect(notice(sp, KEPT)).toBeVisible({ timeout: 10_000 });
    await sp.locator('.toast').getByRole('button', { name: 'Dismiss' }).first().press('Enter');
    expect(await stickyNoteIds(app), action).toEqual([id]);
    await expect(editor(sp)).toHaveText('safe TYPED');
  }
  await closeWindowByUrl(app, `#/sticky/${id}`);
  await expect(notice(sp, KEPT)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  expect(await stickyNoteIds(app)).toEqual([id]);
  expect(readMainLog(h.userData)).toContain(`sticky: kept open note=${id} (text not saved)`);

  // Nothing moved, no tab opened, the sticky flag stayed, and the typed text is still only in the window.
  expect(await tabs(page).count()).toBe(tabsBefore);
  expect(stickyFlag(id)).toBe(1);
  expect(text(id)).toBe('safe');
  expect(draftCount()).toBe(0);

  // Once saving works again the same action goes through and the text is stored.
  await setHook(app, 'failSaves', 0);
  await stickyMenu(sp, 'Open in app');
  await expect.poll(() => stickyNoteIds(app)).toEqual([]);
  await expect.poll(() => text(id)).toBe('safe TYPED');
  await expect.poll(() => editorText(page)).toBe('safe TYPED');
});

test('a sticky whose save fails a few times closes once the retried save succeeded, on every close path', async () => {
  test.setTimeout(120_000);
  const { app, page } = await h.start();
  for (const action of ['Hide', 'Open in app', 'Remove from stickies', 'OS close']) {
    const { id, sp } = await floated(app, page, `Transient ${action}`);
    await setHook(app, 'failSaves', TRANSIENT);
    await typeEnd(sp, ` ${action}`);
    if (action === 'OS close') await closeWindowByUrl(app, `#/sticky/${id}`);
    else await stickyMenu(sp, action);
    await expect.poll(() => stickyNoteIds(app), { timeout: 15_000, message: action }).toEqual([]);
    expect(text(id), action).toBe(`safe ${action}`);
    expect(stickyFlag(id), action).toBe(action === 'Remove from stickies' ? 0 : 1);
  }
  expect(draftCount()).toBe(0);
});

test('Quit is canceled once while a window cannot save; Quit again quits', async () => {
  test.setTimeout(120_000);
  const { app, page } = await h.start();
  const { id, sp } = await floated(app, page, 'Quit sticky');
  const tabNote = await createNote(page, COMMON, 'Quit tab');
  await reloadUi(page);
  await openFromTree(page, tabNote);
  await setHook(app, 'failSaves', PERSISTENT);
  await typeEnd(page, 'tab text');
  await typeEnd(sp, ' sticky text');

  await stickyMenu(sp, 'Quit Infinity Notes');
  await expect(notice(sp, QUIT_CANCELED)).toBeVisible({ timeout: 15_000 });
  await expect(notice(page, QUIT_CANCELED)).toBeVisible();
  await expect.poll(() => readMainLog(h.userData)).toContain('quit: canceled, unsaved windows=2');
  expect(app.process().exitCode).toBeNull();
  expect(await stickyNoteIds(app)).toEqual([id]);
  expect((await windowsOf(app)).main).not.toBeNull();

  // The fault is gone: the next Quit saves both windows and exits.
  await setHook(app, 'failSaves', 0);
  const proc = app.process();
  await stickyMenu(sp, 'Quit Infinity Notes');
  expect(await waitForExit(proc, 20_000)).toBe(true);
  expect([text(id), text(tabNote)]).toEqual(['safe sticky text', 'tab text']);
});

test('Quit waits for a save that succeeds after retries', async () => {
  const { app, page } = await h.start();
  const { id, sp } = await floated(app, page, 'Quit retried');
  await setHook(app, 'failSaves', TRANSIENT);
  await typeEnd(sp, ' retried');
  const proc = app.process();
  await stickyMenu(sp, 'Quit Infinity Notes');
  expect(await waitForExit(proc, 20_000)).toBe(true);
  expect(text(id)).toBe('safe retried');
  expect(readMainLog(h.userData)).toMatch(/flush: requested=2 acked=2 timedOut=0 unsaved=0/);
});

test('closing the main window to the background keeps it open while its note cannot be saved', async () => {
  const { app, page } = await h.start();
  const id = await createNote(page, COMMON, 'Main failing');
  await reloadUi(page);
  await openFromTree(page, id);
  await setHook(app, 'failSaves', PERSISTENT);
  await typeEnd(page, 'unsaved main');
  await queueClose(app, 'background', false);
  await closeWindowByUrl(app, '#/');
  await expect(notice(page, KEPT)).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => readMainLog(h.userData)).toContain('window: main kept open (text not saved)');
  expect((await windowsOf(app)).main).not.toBeNull();
  await setHook(app, 'failSaves', 0);
  await queueClose(app, 'background', false);
  await closeWindowByUrl(app, '#/');
  await expect.poll(async () => (await windowsOf(app)).main).toBeNull();
  expect(text(id)).toBe('unsaved main');
});
