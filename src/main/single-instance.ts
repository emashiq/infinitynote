import { app } from 'electron';
import type { Logger } from './services/logger';
import type { WindowRegistry } from './windows/window-registry';

/** Returns false if another instance already owns the lock (the caller quits). */
export function acquireSingleInstance(): boolean {
  return app.requestSingleInstanceLock();
}

export function installSecondInstanceHandler(registry: WindowRegistry, getLogger: () => Logger | null): void {
  app.on('second-instance', () => {
    getLogger()?.info('second-instance received');
    const win = registry.main();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}
