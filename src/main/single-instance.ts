import { app } from 'electron';
import type { Logger } from './services/logger';

/** Returns false if another instance already owns the lock (the caller quits). */
export function acquireSingleInstance(): boolean {
  return app.requestSingleInstanceLock();
}

/** A second launch brings the main window back, recreating it after it was closed to the background (D-066). */
export function installSecondInstanceHandler(showMainWindow: () => void, getLogger: () => Logger | null): void {
  app.on('second-instance', () => {
    getLogger()?.info('second-instance received');
    showMainWindow();
  });
}
