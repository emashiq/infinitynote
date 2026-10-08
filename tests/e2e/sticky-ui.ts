import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { CloseChoice } from '../../src/main/services/close-dialog';
import type { StickyWindowInfo } from '../../src/main/test-hooks';
import { activate } from './ui';

/** The main window's page (never `windows()[0]`: window order is not creation order, D-064). */
export async function mainPageOf(app: ElectronApplication): Promise<Page> {
  return pageByUrl(app, '#/');
}

/** The page of the sticky window of a note, once its renderer shows the sticky. */
export async function stickyPage(app: ElectronApplication, noteId: string): Promise<Page> {
  const page = await pageByUrl(app, `#/sticky/${noteId}`);
  await page.locator('.sticky-window[data-sticky-color]').waitFor({ timeout: 30_000 });
  return page;
}

async function pageByUrl(app: ElectronApplication, suffix: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      () => {
        found = app.windows().find((p) => !p.isClosed() && p.url().endsWith(suffix));
        return found !== undefined;
      },
      { timeout: 30_000, message: `no window ends with ${suffix}` },
    )
    .toBe(true);
  return found!;
}

export interface WindowsSnapshot {
  main: { webContentsId: number; visible: boolean } | null;
  stickies: StickyWindowInfo[];
}

/** The app's windows as main sees them (test hooks). */
export function windowsOf(app: ElectronApplication): Promise<WindowsSnapshot> {
  return app.evaluate(() => globalThis.__infinityTest!.windows());
}

export async function stickyNoteIds(app: ElectronApplication): Promise<string[]> {
  return (await windowsOf(app)).stickies.map((s) => s.noteId).sort();
}

/** The number of BrowserWindows that exist. */
export function windowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}

/** Floats the active note tab with its header button. */
export async function floatFromTab(page: Page): Promise<void> {
  await activate(page.getByRole('button', { name: 'Float as sticky', exact: true }));
}

export function stickyHeader(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Sticky', exact: true });
}

/**
 * Presses Enter on a control whose action may close its own window (Hide, Open in app, Close window, Quit): the
 * window can be gone before Playwright's press returns, which is the expected outcome, not an error.
 */
export async function pressClosing(locator: Locator): Promise<void> {
  await locator.focus();
  try {
    await locator.press('Enter');
  } catch (err) {
    if (!/has been closed/.test(String(err))) throw err;
  }
}

/** Opens the sticky actions menu and chooses an item, with the keyboard. */
export async function stickyMenu(page: Page, item: string): Promise<void> {
  await activate(stickyHeader(page).getByRole('button', { name: 'Sticky actions', exact: true }));
  const entry = page.getByRole('menu', { name: 'Sticky actions' }).getByRole('menuitem', { name: item, exact: true });
  await entry.waitFor({ state: 'visible' });
  await pressClosing(entry);
}

/** Queues the answer of the next main-window close question (test hooks; an empty queue means Cancel). */
export async function queueClose(app: ElectronApplication, choice: CloseChoice['choice'], remember: boolean): Promise<void> {
  await app.evaluate((_e, c) => {
    globalThis.__infinityTest!.closeChoices.push(c);
  }, { choice, remember });
}

/** BrowserWindow.close() on the window whose URL ends with the suffix (the OS close path). */
export async function closeWindowByUrl(app: ElectronApplication, suffix: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, s) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith(s))!
      .close();
  }, suffix);
}

export function listenerCounts(app: ElectronApplication): Promise<Record<string, number>> {
  return app.evaluate(() => globalThis.__infinityTest!.listenerCounts());
}
