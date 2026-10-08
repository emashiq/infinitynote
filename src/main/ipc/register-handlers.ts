import type { MainServices } from '../main-services';
import { AppError } from '../services/app-error';
import type { MainWindowController } from '../windows/main-window-controller';
import type { StickyManager } from '../windows/sticky-manager';
import { registerAppHandlers, type AppHandlerDeps } from './handlers/app-handlers';
import { registerAttachmentHandlers } from './handlers/attachment-handlers';
import { registerContentHandlers } from './handlers/content-handlers';
import { registerHierarchyHandlers } from './handlers/hierarchy-handlers';
import { registerHomeHandlers } from './handlers/home-handlers';
import { registerNoteHandlers } from './handlers/note-handlers';
import { registerPaletteHandlers } from './handlers/palette-handlers';
import { registerSessionHandlers } from './handlers/session-handlers';
import { registerSettingsHandlers } from './handlers/settings-handlers';
import { registerStickyHandlers } from './handlers/sticky-handlers';
import { registerTrashHandlers } from './handlers/trash-handlers';
import { registerWindowHandlers } from './handlers/window-handlers';
import type { IpcRouter } from './router';

/** The windows side of the app; stickies need storage, so they are null when the database failed to open. */
export interface DesktopHandlerDeps {
  mainWindow: Pick<MainWindowController, 'rendererReady'>;
  stickies: StickyManager | null;
}

const storageUnavailable = (): never => {
  throw new AppError('INTERNAL', 'Storage is unavailable');
};

/**
 * Registers every catalogue channel. When the database failed to open (`services` is null) the app channels
 * still work and every storage channel answers INTERNAL "Storage is unavailable".
 */
export function registerIpcHandlers(router: IpcRouter, deps: { app: AppHandlerDeps; services: MainServices | null; desktop: DesktopHandlerDeps }): void {
  const { services, desktop } = deps;
  const use =
    <K extends keyof MainServices>(key: K) =>
    (): MainServices[K] =>
      services ? services[key] : storageUnavailable();
  const stickies = (): StickyManager => desktop.stickies ?? storageUnavailable();
  registerAppHandlers(router, deps.app);
  registerSettingsHandlers(router, use('settings'));
  registerHierarchyHandlers(router, use('hierarchy'));
  registerTrashHandlers(router, use('trash'));
  registerHomeHandlers(router, use('home'));
  registerSessionHandlers(router, use('sessions'));
  registerPaletteHandlers(router, use('palette'));
  registerNoteHandlers(router, { reader: use('reader'), writer: use('writer'), leases: use('leases'), formats: use('formats') });
  registerContentHandlers(router, { versions: use('versions'), drafts: use('drafts') });
  registerAttachmentHandlers(router, use('attachments'));
  registerStickyHandlers(router, stickies);
  registerWindowHandlers(router, { mainWindow: desktop.mainWindow, stickies });
}
