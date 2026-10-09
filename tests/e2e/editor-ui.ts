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

/** Clicks into the editor and puts the cursor at the end of the document. */
export async function focusEditorEnd(page: Page): Promise<void> {
  await editor(page).click();
  await page.keyboard.press('Control+End');
}

/** Types text line by line (Enter between lines) at the cursor. */
export async function typeLines(page: Page, text: string): Promise<void> {
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    if (line !== '') await page.keyboard.insertText(line);
  }
}

export function toolbar(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Formatting' });
}

export function toolbarButton(page: Page, name: string): Locator {
  return toolbar(page).getByRole('button', { name, exact: true });
}

/** Keyboard activation of a toolbar button (D-050): focus it and press Enter. */
export async function pressToolbar(page: Page, name: string): Promise<void> {
  const button = toolbarButton(page, name);
  await button.focus();
  await button.press('Enter');
}

/** Opens the toolbar's More menu and chooses an item, with the keyboard. */
export async function chooseMore(page: Page, item: string): Promise<void> {
  await pressToolbar(page, 'More');
  const entry = page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: item, exact: true });
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

export function saveStatus(page: Page): Locator {
  return page.locator('.note-meta .save-status');
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

/** Queues the paths the next native file dialog "chooses" (test hooks; an empty queue means canceled). */
export async function queueDialog(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate((_e, p) => {
    globalThis.__infinityTest!.dialogQueue.push(p);
  }, paths);
}

export type TestHookKey = 'failSaves' | 'importDelayMs';

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

/** The second editing view that lives in main (test hooks): leases and saves without a second window. */
export const fakeView = {
  acquire: (app: ElectronApplication, noteId: string) => app.evaluate((_e, id) => globalThis.__infinityTest!.fakeView!.acquire(id), noteId),
  release: (app: ElectronApplication, noteId: string) => app.evaluate((_e, id) => globalThis.__infinityTest!.fakeView!.release(id), noteId),
  take: (app: ElectronApplication, noteId: string) => app.evaluate((_e, id) => globalThis.__infinityTest!.fakeView!.take(id), noteId),
  save: (app: ElectronApplication, noteId: string, text: string) =>
    app.evaluate((_e, [id, t]) => globalThis.__infinityTest!.fakeView!.save(id!, t!), [noteId, text] as const),
  forceWrite: (app: ElectronApplication, noteId: string, text: string, emit: boolean) =>
    app.evaluate((_e, [id, t, e]) => globalThis.__infinityTest!.fakeView!.forceWrite(id as string, t as string, { emit: e as boolean }), [noteId, text, emit] as const),
  setReleaseBehavior: (app: ElectronApplication, behavior: 'release' | 'ignore') =>
    app.evaluate((_e, b) => {
      globalThis.__infinityTest!.fakeView!.releaseBehavior = b;
    }, behavior),
};
