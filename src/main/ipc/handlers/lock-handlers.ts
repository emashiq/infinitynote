import type { LockService } from '../../locks/lock-service';
import type { IpcRouter } from '../router';

/** Locked notes (D-111..D-113). The channels are main-window only; passwords are never logged or echoed. */
export function registerLockHandlers(router: IpcRouter, locks: () => LockService): void {
  router.register('lock:availability', () => locks().availability());
  router.register('lock:status', (req) => locks().status(req.noteId));
  router.register('lock:set', (req) => locks().lock(req));
  router.register('lock:unlock', (req) => locks().unlock(req));
  router.register('lock:unlockHello', (req) => locks().unlockWithHello(req.noteId));
  router.register('lock:lockNow', (req) => locks().lockNow(req.noteId));
  router.register('lock:lockAll', () => ({ locked: locks().lockAll() }));
  router.register('lock:changePassword', (req) => locks().changePassword(req));
  router.register('lock:setHello', (req) => locks().setHello(req));
  router.register('lock:remove', (req) => locks().remove(req));
}
