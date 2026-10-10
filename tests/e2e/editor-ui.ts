import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { Harness } from './harness';

/** The note editor (a ProseMirror contenteditable with role textbox). */
export function editor(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Note text', exact: true });
}

/** The editor text with one line per top-level block (paragraph lists read like the old text area). */
export function editorText(page: Page): Promise<string> {
  return editor(page).evaluate((el) => [...el.children].map((c) => c.textContent ?? '').join('\n'));
}

/**
 * The text of the editor's own selection. ProseMirror reads DOM selection changes on the asynchronous
 * selectionchange event, so a test that selects with keys waits for this before using a toolbar action.
 */
export function editorSelectionText(page: Page): Promise<string> {
  return editor(page).evaluate((el) => {
    const view = (el as unknown as { editor: { state: { doc: { textBetween(a: number, b: number): string }; selection: { from: number; to: number } } } }).editor;
    return view.state.doc.textBetween(view.state.selection.from, view.state.selection.to);
  });
}

/**
 * Clicks into the editor and puts the cursor at the end of the document. ProseMirror reads the DOM selection change on
 * the asynchronous selectionchange event, so this waits until the editor's own cursor is at the end: a key pressed
 * earlier would act at the clicked position.
 */
export async function focusEditorEnd(page: Page): Promise<void> {
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await expect
    .poll(() =>
      editor(page).evaluate((el) => {
        const { state } = (el as unknown as { editor: { state: { doc: { content: { size: number } }; selection: { empty: boolean; head: number } } } }).editor;
        return state.selection.empty && state.selection.head === state.doc.content.size - 1;
      }),
    )
    .toBe(true);
}

/** Types text line by line (Enter between lines) at the cursor. */
export async function typeLines(page: Page, text: string): Promise<void> {
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    if (line !== '') await page.keyboard.insertText(line);
  }
}

/** The floating formatting toolbar of a rich note (D-102). */
export function toolbar(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Formatting' });
}

export function toolbarButton(page: Page, name: string): Locator {
  return toolbar(page).getByRole('button', { name, exact: true });
}

/** Shows the formatting toolbar from the keyboard: Alt+F10 in the text, at the selection or the cursor (D-102). */
export async function openFormatting(page: Page): Promise<void> {
  await editor(page).focus();
  await page.keyboard.press('Alt+F10');
}

/** Keyboard activation of a formatting button (D-050): Alt+F10, focus the button and press Enter. */
export async function pressToolbar(page: Page, name: string): Promise<void> {
  await openFormatting(page);
  const button = toolbarButton(page, name);
  await button.focus();
  await button.press('Enter');
}

/** The note menu of the text (right-click or Shift+F10; D-102). */
export function noteMenu(page: Page): Locator {
  return page.getByRole('menu', { name: 'Note actions' });
}

/** Opens the note menu with Shift+F10 in the text and chooses an item, with the keyboard. */
export async function chooseNoteMenu(page: Page, item: string): Promise<void> {
  await editor(page).focus();
  await page.keyboard.press('Shift+F10');
  const entry = noteMenu(page).getByRole('menuitem', { name: item, exact: true });
  await entry.focus();
  await entry.press('Enter');
}

/** Runs a command palette action by its label. */
export async function paletteAction(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox', { name: 'Type a command or search notes' }).fill(label);
  await page.getByRole('option', { name: new RegExp(label) }).first().waitFor({ state: 'visible' });
  await page.keyboard.press('Enter');
}

export function findInput(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Find in note', exact: true });
}

/** The note tab's save state; shown only when the note is not saved, always read by screen readers (D-102). */
export function saveStatus(page: Page): Locator {
  return page.locator('.note-view .save-status');
}

export async function waitSaved(page: Page): Promise<void> {
  await expect(saveStatus(page)).toHaveText('Saved');
}

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

/** The stored rich document of a note. */
export function docOf(h: Harness, noteId: string): DocNode {
  const row = h.one<{ content_json: string | null }>('SELECT content_json FROM notes WHERE id = ?', noteId);
  if (!row?.content_json) throw new Error(`note ${noteId} has no rich content`);
  return JSON.parse(row.content_json) as DocNode;
}

/** Every node of a document, depth first. */
export function nodesOf(doc: DocNode): DocNode[] {
  const out: DocNode[] = [];
  const walk = (n: DocNode) => {
    out.push(n);
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}

/** The block IDs in document order. */
export function blockIds(doc: DocNode): Array<string | null> {
  return nodesOf(doc)
    .filter((n) => ['paragraph', 'heading', 'codeBlock', 'blockquote', 'listItem', 'taskItem', 'image', 'fileAttachment'].includes(n.type))
    .map((n) => (n.attrs?.id as string | undefined) ?? null);
}

/**
 * Puts a PNG on the real OS clipboard from the main process (Electron 44 async clipboard API, D-054). Fails with a
 * clear message when the clipboard does not report the image afterwards (for example another app holds it).
 */
export async function seedClipboardImage(app: ElectronApplication, png: Buffer): Promise<void> {
  const ok = await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
    const bytes = Buffer.from(b64, 'base64');
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    return clipboard.has('image/png');
  }, png.toString('base64'));
  if (!ok) throw new Error('The OS clipboard did not accept the test image (is another application holding it?)');
}

/** Puts HTML (with a plain-text alternative) on the real OS clipboard from the main process. */
/**
 * Runs a step that changes the selection and waits until the browser announced it: editors read a selection change on
 * the asynchronous selectionchange event, so a command given before then (a toolbar button, a shortcut) would act on
 * the old selection. A person is never that fast; Playwright is.
 */
export async function selectionChange(page: Page, step: () => Promise<void>): Promise<void> {
  const announced = page.evaluate(() => new Promise<void>((resolve) => document.addEventListener('selectionchange', () => setTimeout(resolve, 0), { once: true })));
  await step();
  await announced;
}

/** The HTML on the OS clipboard (Electron's web-style clipboard), or '' when it holds none. */
export function clipboardHtml(app: ElectronApplication): Promise<string> {
  return app.evaluate(async ({ clipboard }) => {
    const [item] = await clipboard.read();
    return item?.types.includes('text/html') ? (await item.getType('text/html')).text() : '';
  });
}

export async function seedClipboardHtml(app: ElectronApplication, html: string, text: string): Promise<void> {
  const ok = await app.evaluate(
    async ({ clipboard, ClipboardItem }, [h, t]) => {
      await clipboard.write([new ClipboardItem({ 'text/html': new Blob([h!], { type: 'text/html' }), 'text/plain': new Blob([t!], { type: 'text/plain' }) })]);
      return clipboard.has('text/html');
    },
    [html, text],
  );
  if (!ok) throw new Error('The OS clipboard did not accept the test HTML (is another application holding it?)');
}

/** A real paste: Ctrl+V into the focused editor (the probe showed it delivers clipboard data on every host). */
export async function paste(page: Page): Promise<void> {
  await page.keyboard.press('Control+V');
}

export interface DropFile {
  name: string;
  type: string;
  /** File bytes as base64, or a size for a zero-filled file. */
  base64?: string;
  size?: number;
}

/**
 * SYNTHETIC file drop: Playwright cannot drag files from the OS, so this builds a DataTransfer with File objects in
 * the page and dispatches dragenter, dragover and drop on the editor (labelled synthetic in the report, D-054).
 */
export async function dropFiles(page: Page, files: DropFile[]): Promise<void> {
  await editor(page).evaluate((el, list) => {
    const dt = new DataTransfer();
    for (const f of list) {
      const bytes = f.base64 ? Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)) : new Uint8Array(f.size ?? 0);
      dt.items.add(new File([bytes], f.name, { type: f.type }));
    }
    const rect = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + 10, clientY: rect.top + 10 };
    el.dispatchEvent(new DragEvent('dragenter', init));
    el.dispatchEvent(new DragEvent('dragover', init));
    el.dispatchEvent(new DragEvent('drop', init));
  }, files);
}

/**
 * Drops files from disk (D-108). Playwright cannot drag from the file manager, so a hidden file input gets the real
 * files (Files backed by their paths, as a drag from the file manager gives) and a synthetic drop carries them.
 */
export async function dropDiskFiles(page: Page, paths: string[]): Promise<void> {
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.id = 'e2e-disk-files';
    input.hidden = true;
    document.body.append(input);
  });
  await page.locator('#e2e-disk-files').setInputFiles(paths);
  await editor(page).evaluate((el) => {
    const input = document.getElementById('e2e-disk-files') as HTMLInputElement;
    const dt = new DataTransfer();
    for (const file of Array.from(input.files ?? [])) dt.items.add(file);
    input.remove();
    const rect = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + 10, clientY: rect.bottom - 4 };
    el.dispatchEvent(new DragEvent('dragenter', init));
    el.dispatchEvent(new DragEvent('dragover', init));
    el.dispatchEvent(new DragEvent('drop', init));
  });
}

/** Queues the paths the next native file dialog "chooses" (test hooks; an empty queue means canceled). */
export async function queueDialog(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate((_e, p) => {
    globalThis.__infinityTest!.dialogQueue.push(p);
  }, paths);
}

export type TestHookKey = 'failSaves' | 'importDelayMs' | 'startupDelayMs';

export async function setHook(app: ElectronApplication, key: TestHookKey, value: number): Promise<void> {
  await app.evaluate(
    (_e, [k, v]) => {
      (globalThis.__infinityTest as unknown as Record<string, number>)[k as string] = v as number;
    },
    [key, value] as const,
  );
}

export function shellCalls(app: ElectronApplication): Promise<Array<{ op: string; url?: string; path?: string }>> {
  return app.evaluate(() => globalThis.__infinityTest!.shellCalls.map((c) => ({ ...c })));
}

export function blockedRequests(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => [...globalThis.__infinityTest!.blockedRequests]);
}

/** Changes a note behind the app's back, as another writer would (test hooks; `emit` announces the revision). */
export function externalWrite(app: ElectronApplication, noteId: string, text: string, emit: boolean): Promise<number> {
  return app.evaluate((_e, [id, t, e]) => globalThis.__infinityTest!.externalWrite!(id as string, t as string, { emit: e as boolean }), [noteId, text, emit] as const);
}
