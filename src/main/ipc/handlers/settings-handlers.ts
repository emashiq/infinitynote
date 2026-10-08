import type { SettingsService } from '../../services/settings-service';
import type { IpcRouter } from '../router';

export function registerSettingsHandlers(router: IpcRouter, settings: () => SettingsService): void {
  router.register('settings:get', (req) => ({ values: settings().get(req.keys) }));
  router.register('settings:set', (req) => settings().set(req.key, req.value));
}
