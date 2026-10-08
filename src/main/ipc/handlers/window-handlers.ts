import type { MainWindowController } from '../../windows/main-window-controller';
import type { StickyManager } from '../../windows/sticky-manager';
import type { IpcRouter } from '../router';

export interface WindowHandlerDeps {
  mainWindow: Pick<MainWindowController, 'rendererReady'>;
  stickies: () => StickyManager;
}

/**
 * `window:getState`: the main renderer's ready handshake (it receives the queued note opens, D-071), or the state of
 * a sticky window's own note (the registry, not the URL, says which note that is).
 */
export function registerWindowHandlers(router: IpcRouter, deps: WindowHandlerDeps): void {
  router.register('window:getState', (_req, ctx) =>
    ctx.sender.role === 'main'
      ? { role: 'main' as const, openNotes: deps.mainWindow.rendererReady(ctx.webContentsId) }
      : { role: 'sticky' as const, sticky: deps.stickies().stateOf(ctx.sender.noteId) },
  );
}
