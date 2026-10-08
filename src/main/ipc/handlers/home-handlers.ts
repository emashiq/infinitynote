import { CHANNEL_SCHEMAS } from '../../../shared/contracts/channels';
import type { HomeScopeType } from '../../../shared/contracts/home';
import type { HomeService } from '../../services/home-service';
import type { IpcRouter } from '../router';
import { need } from './need';

export function registerHomeHandlers(router: IpcRouter, get: () => HomeService | null): void {
  router.register({
    channel: 'home:summary',
    ...CHANNEL_SCHEMAS['home:summary'],
    handler: (req: { scope: HomeScopeType }) => need(get).summary(req.scope),
  });
}
