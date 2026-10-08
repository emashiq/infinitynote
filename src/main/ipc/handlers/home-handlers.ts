import type { HomeService } from '../../services/home-service';
import type { IpcRouter } from '../router';

export function registerHomeHandlers(router: IpcRouter, home: () => HomeService): void {
  router.register('home:summary', (req) => home().summary(req.scope));
}
