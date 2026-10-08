import { CHANNEL_SCHEMAS } from '../../../shared/contracts/channels';
import type { SettingKey } from '../../../shared/contracts/settings';
import { AppError } from '../../services/app-error';
import type { SettingsService } from '../../services/settings-service';
import type { IpcRouter } from '../router';

export function registerSettingsHandlers(router: IpcRouter, getSettings: () => SettingsService | null): void {
  const need = (): SettingsService => {
    const s = getSettings();
    if (!s) throw new AppError('INTERNAL', 'Storage is unavailable');
    return s;
  };
  router.register({
    channel: 'settings:get',
    ...CHANNEL_SCHEMAS['settings:get'],
    handler: (req: { keys: SettingKey[] }) => ({ values: need().get(req.keys) }),
  });
  router.register({
    channel: 'settings:set',
    ...CHANNEL_SCHEMAS['settings:set'],
    handler: (req: { key: SettingKey; value: unknown }) => need().set(req.key, req.value),
  });
}
