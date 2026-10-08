import type { App, BrowserWindow } from 'electron';
import type { Logger } from './services/logger';
import type { MainWindowOptions } from './windows/main-window';
import type { WindowRegistry } from './windows/window-registry';

export const CRASH_RELOAD_DELAY_MS = 500;
export const MAX_CRASH_RELOADS = 3;
export const CRASH_WINDOW_MS = 60_000;

export interface WindowLifecycleDeps {
  app: Pick<App, 'on' | 'quit'>;
  registry: WindowRegistry;
  logger: Logger;
  /** Asks each renderer to flush and waits for its acknowledgment (bounded per renderer). */
  flush(webContentsIds: number[]): Promise<void>;
  /** The renderer document of a webContents went away: revoke its leases. */
  resetLeases(webContentsId: number): void;
  now?: () => number;
}

/**
 * Window close, app quit, renderer crash and reload handling (INF-SAVE-01, INF-SAVE-05, D-055): closing a window
 * or quitting first flushes the renderers; a crashed renderer is reloaded (at most 3 times a minute); any new
 * document drops the leases of the previous one.
 */
export function createWindowLifecycle(deps: WindowLifecycleDeps) {
  const now = deps.now ?? Date.now;
  let quitting = false;
  let quitFlushStarted = false;
  const crashes: number[] = [];

  deps.app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (quitFlushStarted) return;
    quitFlushStarted = true;
    const open = deps.registry.all().filter((w) => !w.isDestroyed()).map((w) => w.webContentsId);
    void deps.flush(open).finally(() => {
      quitting = true;
      deps.app.quit();
    });
  });

  /** Hooks for one main window. */
  function windowHooks(): Pick<MainWindowOptions, 'onCloseRequest' | 'onRendererGone' | 'onNavigated'> {
    let allowClose = false;
    let closing = false;
    return {
      onCloseRequest(event, win) {
        if (allowClose || quitting) return;
        event.preventDefault();
        if (closing) return;
        closing = true;
        void deps.flush([win.webContents.id]).finally(() => {
          allowClose = true;
          if (!win.isDestroyed()) win.close();
        });
      },
      onRendererGone(webContentsId, reason, win) {
        deps.resetLeases(webContentsId);
        if (reason === 'clean-exit') return;
        deps.logger.warn(`renderer-gone reason=${reason}`);
        reloadAfterCrash(win);
      },
      onNavigated(webContentsId) {
        deps.resetLeases(webContentsId);
      },
    };
  }

  function reloadAfterCrash(win: BrowserWindow): void {
    const t = now();
    while (crashes.length > 0 && crashes[0]! < t - CRASH_WINDOW_MS) crashes.shift();
    if (crashes.length >= MAX_CRASH_RELOADS) {
      deps.logger.error('renderer crashed too often; not reloading');
      return;
    }
    crashes.push(t);
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.reload();
    }, CRASH_RELOAD_DELAY_MS);
  }

  return { windowHooks, isQuitting: () => quitting };
}
