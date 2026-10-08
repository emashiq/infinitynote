import { expect, test, type ElectronApplication } from '@playwright/test';
import { editorText, focusEditorEnd, waitSaved } from './editor-ui';
import { readMainLog, waitForExit } from './fixtures';
import { useApp } from './harness';
import { COMMON, createNote, reloadUi } from './seed';
import { openFromTree } from './ui';

const h = useApp();
const plainText = (id: string) => h.one<{ plain_text: string }>('SELECT plain_text FROM notes WHERE id = ?', id)?.plain_text;

async function typedAndSaved(text: string) {
  const launched = await h.start();
  const id = await createNote(launched.page, COMMON, 'Crash note');
  await reloadUi(launched.page);
  await openFromTree(launched.page, id);
  await focusEditorEnd(launched.page);
  await launched.page.keyboard.insertText(text);
  await waitSaved(launched.page);
  await expect.poll(() => plainText(id)).toBe(text);
  return { ...launched, id };
}

/**
 * Runs script in the main window's current document through main (R3-08: the Playwright page object stays
 * "crashed" after forcefullyCrashRenderer, while main reloads the same webContents).
 */
function inWindow<T>(app: ElectronApplication, script: string): Promise<T | null> {
  return app.evaluate(async ({ BrowserWindow }, js) => {
    const wc = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.webContents;
    if (wc.isCrashed() || wc.isLoading()) return null;
    // A document that is going away never answers; give up after 2 s and let the caller poll again.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
    return (await Promise.race([wc.executeJavaScript(js).catch(() => null), timeout])) as T | null;
  }, script);
}

test('renderer crash keeps acked text and reloads editable (INF-SAVE-05)', async () => {
  const { app, id } = await typedAndSaved('acknowledged before the crash');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#/'))!.webContents.forcefullyCrashRenderer());
  await expect.poll(() => /renderer-gone reason=(crashed|killed)/.test(readMainLog(h.userData))).toBe(true);
  await expect.poll(() => (readMainLog(h.userData).match(/renderer:loaded/g) ?? []).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  // Main reloads the crashed window after 500 ms; the reloaded app restores the note tab.
  await expect.poll(() => inWindow<string>(app, `document.querySelector('#app-shell')?.dataset.ready ?? ''`), { timeout: 30_000 }).toBe('true');
  await expect.poll(() => inWindow<string>(app, `document.querySelector('.ProseMirror')?.textContent ?? ''`)).toBe('acknowledged before the crash');
  // The crashed document's lease was reset, so the reloaded window edits (and saves) again.
  await expect.poll(() => inWindow<string>(app, `document.querySelector('.ProseMirror')?.getAttribute('contenteditable') ?? ''`)).toBe('true');
  await inWindow(app, `document.querySelector('.ProseMirror').editor.chain().focus('end').insertContent(' and after').run()`);
  await expect.poll(() => plainText(id)).toBe('acknowledged before the crash and after');
});

test('killed process keeps acked text (INF-SAVE-05)', async () => {
  const { app } = await typedAndSaved('acknowledged before the kill');
  const proc = app.process();
  proc.kill('SIGKILL');
  expect(await waitForExit(proc, 15_000)).toBe(true);
  const second = await h.restart();
  await expect.poll(() => editorText(second.page)).toBe('acknowledged before the kill');
});
