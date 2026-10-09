import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { activate } from './ui';

/** A temporary folder outside every profile for backups and exports; removed by the caller. */
export function tempFolder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-e2e-files-'));
}

/** Queues the path the next save dialog "chooses" (test hooks; an empty queue means canceled). */
export async function queueSave(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate((_e, f) => {
    globalThis.__infinityTest!.saveDialogQueue.push(f);
  }, file);
}

export function pathDialogs(app: ElectronApplication): Promise<Array<{ kind: string; title: string; defaultName?: string }>> {
  return app.evaluate(() => globalThis.__infinityTest!.pathDialogs.map((d) => ({ ...d })));
}

/** Opens a title-bar menu (File, View, Help) and chooses an item with the keyboard (D-050). */
export async function chooseAppMenu(page: Page, menu: 'File' | 'View' | 'Help', item: string): Promise<void> {
  await activate(page.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: menu, exact: true }));
  await activate(page.getByRole('menu', { name: menu }).getByRole('menuitem', { name: item }));
}

export function settingsSection(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

export async function pressButton(scope: Locator, name: string): Promise<void> {
  await activate(scope.getByRole('button', { name, exact: true }));
}

/** Waits until the app process has exited on its own (a restore restarts the app; under the hooks it only quits). */
export async function waitForAppExit(app: ElectronApplication): Promise<void> {
  const proc = app.process();
  await expect.poll(() => proc.exitCode !== null || proc.signalCode !== null, { timeout: 20_000 }).toBe(true);
}
