import type { GlobalShortcutService } from '../../services/global-shortcut';
import type { IpcRouter } from '../router';

/** The optional global quick-sticky shortcut (INF-KEY-05); main window only. */
export function registerShortcutHandlers(router: IpcRouter, shortcut: () => GlobalShortcutService): void {
  router.register('shortcut:getGlobal', () => shortcut().state());
  router.register('shortcut:setGlobal', (req) => shortcut().set(req));
}
