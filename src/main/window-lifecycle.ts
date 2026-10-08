import type { App } from 'electron';
import type { FlushReasonType } from '../shared/contracts/app';
import type { FlushOutcome } from './services/flush-coordinator';
import type { Logger } from './services/logger';
import type { WindowRegistry } from './windows/window-registry';

export const CRASH_RELOAD_DELAY_MS = 500;
export const MAX_CRASH_RELOADS = 3;
export const CRASH_WINDOW_MS = 60_000;

/** Renderer and session events of one window. */
export interface WindowHooks {
  /** The renderer process ended (crash, kill, out of memory or a clean exit); `reload` loads it again. */
  onRendererGone(webContentsId: number, reason: string, reload: () => void): void;
  /** The main frame committed a new document (a reload or navigation), so the previous document is gone. */
  onNavigated(webContentsId: number): void;
  /** The OS session ends (Windows logoff or shutdown). */
  onSessionEnd(): void;
}

export interface WindowLifecycleDeps {
  app: Pick<App, 'on' | 'quit'>;
  registry: WindowRegistry;
  logger: Logger;
  /** Asks each renderer to flush and waits for its answer (bounded per renderer). */
  flush(webContentsIds: number[], reason: FlushReasonType): Promise<FlushOutcome>;
  /** The renderer document of a webContents went away: revoke its leases. */
  resetLeases(webContentsId: number): void;
  /** Quitting starts (Quit, or the OS session ends): windows save their state before anything closes. */
  onQuitStarting(): void;
  /** A quit was canceled because a window could not save its text; windows behave normally again. */
  onQuitCanceled(): void;
  now?: () => number;
}

/**
 * App quit, session end, renderer crash and reload handling (INF-SAVE-01, INF-SAVE-05, D-055, D-066, D-072): quitting
 * first flushes every renderer; when a window answers that its text could not be saved, the first Quit is canceled
 * (the window shows why) and a repeated Quit goes ahead. A renderer that does not answer within the bounded wait does
 * not block quitting. A crashed renderer is reloaded (at most 3 times a minute per window); any new document drops
 * the leases of the previous one. Window close policies live in the window controllers.
 */
export function createWindowLifecycle(deps: WindowLifecycleDeps) {
  const now = deps.now ?? Date.now;
  let quitting = false;
  let quitFlushStarted = false;
  let quitCanceled = false;

  deps.app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (quitFlushStarted) return;
    quitFlushStarted = true;
    deps.onQuitStarting();
    const open = deps.registry.all().filter((w) => !w.isDestroyed()).map((w) => w.webContentsId);
    void deps.flush(open, 'quit').then(
      (outcome) => {
        if (outcome.unsaved.length > 0 && !quitCanceled) {
          quitCanceled = true;
          quitFlushStarted = false;
          deps.logger.warn(`quit: canceled, unsaved windows=${outcome.unsaved.length}`);
          deps.onQuitCanceled();
          return;
        }
        quitting = true;
        deps.app.quit();
      },
      (err: unknown) => {
        deps.logger.error(`quit: flush failed ${String(err)}`);
        quitting = true;
        deps.app.quit();
      },
    );
  });

  /** The session ends: no dialog and no flush wait, so the logoff is never blocked (plan section 8.10). */
  function markQuitting(): void {
    if (quitting) return;
    quitting = true;
    deps.onQuitStarting();
    deps.logger.info('session end: quitting');
  }

  /** Hooks for one window, with its own crash counter. */
  function windowHooks(): WindowHooks {
    const crashes: number[] = [];
    return {
      onRendererGone(webContentsId, reason, reload) {
        deps.resetLeases(webContentsId);
        if (reason === 'clean-exit') return;
        deps.logger.warn(`renderer-gone reason=${reason}`);
        const t = now();
        while (crashes.length > 0 && crashes[0]! < t - CRASH_WINDOW_MS) crashes.shift();
        if (crashes.length >= MAX_CRASH_RELOADS) {
          deps.logger.error('renderer crashed too often; not reloading');
          return;
        }
        crashes.push(t);
        setTimeout(reload, CRASH_RELOAD_DELAY_MS);
      },
      onNavigated(webContentsId) {
        deps.resetLeases(webContentsId);
      },
      onSessionEnd: markQuitting,
    };
  }

  return { windowHooks, markQuitting, isQuitting: () => quitting };
}

export type WindowLifecycle = ReturnType<typeof createWindowLifecycle>;
