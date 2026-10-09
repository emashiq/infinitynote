import type { MainWindowController } from '../../windows/main-window-controller';
import type { StickyManager } from '../../windows/sticky-manager';
import type { WidgetStateType } from '../../../shared/contracts/widget';
import type { WidgetManager } from '../../windows/widget-manager';
import type { IpcRouter } from '../router';

export interface WindowHandlerDeps {
  mainWindow: Pick<MainWindowController, 'rendererReady'>;
  stickies: () => StickyManager;
  widget: () => WidgetManager;
  /** The widget state for the main window, closed when there is no storage (and so no widget). */
  widgetState(): WidgetStateType;
}

/**
 * `window:getState`: the main renderer's ready handshake (it receives the queued note and Reminders opens, D-071), the
 * state of a sticky window's own note (the registry, not the URL, says which note that is) or the widget's state.
 */
export function registerWindowHandlers(router: IpcRouter, deps: WindowHandlerDeps): void {
  router.register('window:getState', (_req, ctx) => {
    const { sender } = ctx;
    if (sender.role === 'sticky') return { role: 'sticky' as const, sticky: deps.stickies().stateOf(sender.noteId) };
    if (sender.role === 'widget') return { role: 'widget' as const, widget: deps.widget().state() };
    return { role: 'main' as const, ...deps.mainWindow.rendererReady(ctx.webContentsId), widget: deps.widgetState() };
  });
}
