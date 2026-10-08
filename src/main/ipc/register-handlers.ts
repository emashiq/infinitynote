import type { MainServices } from '../main-services';
import { AppError } from '../services/app-error';
import { registerAppHandlers, type AppHandlerDeps } from './handlers/app-handlers';
import { registerHierarchyHandlers } from './handlers/hierarchy-handlers';
import { registerHomeHandlers } from './handlers/home-handlers';
import { registerNoteHandlers } from './handlers/note-handlers';
import { registerPaletteHandlers } from './handlers/palette-handlers';
import { registerSessionHandlers } from './handlers/session-handlers';
import { registerSettingsHandlers } from './handlers/settings-handlers';
import { registerTrashHandlers } from './handlers/trash-handlers';
import type { IpcRouter } from './router';

/**
 * Registers every catalogue channel. When the database failed to open (`services` is null) the app channels
 * still work and every storage channel answers INTERNAL "Storage is unavailable".
 */
export function registerIpcHandlers(router: IpcRouter, deps: { app: AppHandlerDeps; services: MainServices | null }): void {
  const { services } = deps;
  const use =
    <K extends keyof MainServices>(key: K) =>
    (): MainServices[K] => {
      if (!services) throw new AppError('INTERNAL', 'Storage is unavailable');
      return services[key];
    };
  registerAppHandlers(router, deps.app);
  registerSettingsHandlers(router, use('settings'));
  registerHierarchyHandlers(router, use('hierarchy'));
  registerTrashHandlers(router, use('trash'));
  registerHomeHandlers(router, use('home'));
  registerSessionHandlers(router, use('sessions'));
  registerPaletteHandlers(router, use('palette'));
  registerNoteHandlers(router, { reader: use('reader'), writer: use('writer'), leases: use('leases') });
}
