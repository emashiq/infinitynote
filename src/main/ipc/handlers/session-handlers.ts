import type { SessionService } from '../../services/session-service';
import type { IpcRouter } from '../router';

export function registerSessionHandlers(router: IpcRouter, sessions: () => SessionService): void {
  router.register('session:get', () => sessions().get());
  router.register('session:set', (req) => sessions().set(req.session));
}
