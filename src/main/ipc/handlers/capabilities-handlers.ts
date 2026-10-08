import type { CapabilitiesType } from '../../../shared/contracts/app';
import { CHANNEL_SCHEMAS } from '../../../shared/contracts/channels';
import type { IpcRouter } from '../router';

export function registerCapabilitiesHandlers(router: IpcRouter, getCapabilities: () => CapabilitiesType): void {
  router.register({
    channel: 'capabilities:get',
    ...CHANNEL_SCHEMAS['capabilities:get'],
    handler: () => getCapabilities(),
  });
}
