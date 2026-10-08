import { CHANNEL_SCHEMAS } from '../../../shared/contracts/channels';
import type { TabSessionType } from '../../../shared/contracts/session';
import type { SessionService } from '../../services/session-service';
import type { IpcRouter } from '../router';
import { need } from './need';

export function registerSessionHandlers(router: IpcRouter, get: () => SessionService | null): void {
  router.register({ channel: 'session:get', ...CHANNEL_SCHEMAS['session:get'], handler: () => need(get).get() });
  router.register({
    channel: 'session:set',
    ...CHANNEL_SCHEMAS['session:set'],
    handler: (req: { session: TabSessionType }) => need(get).set(req.session),
  });
}
