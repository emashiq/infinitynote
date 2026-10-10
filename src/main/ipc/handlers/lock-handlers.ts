import type { LockService } from '../../locks/lock-service';
import type { StickyLockService } from '../../locks/sticky-locks';
import type { StickyManager } from '../../windows/sticky-manager';
import type { IpcRouter } from '../router';

export interface LockHandlerDeps {
  locks: () => LockService;
  stickyLocks: () => StickyLockService;
  stickies: () => StickyManager;
}

/**
 * Locked notes (D-111..D-113) and locked stickies (D-171..D-173). The `lock:*` channels are main-window only; a sticky
 * window uses the `sticky:*` lock channels for its own note (the router checks the note). Passwords and PINs are never
 * logged or echoed.
 */
export function registerLockHandlers(router: IpcRouter, deps: LockHandlerDeps): void {
  const { locks, stickyLocks, stickies } = deps;
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
  // A new locked sticky floats at once and is revealed there: the password was just typed (D-171).
  router.register('lock:create', async (req) => {
    const created = await locks().create(req);
    if (req.sticky) {
      await stickies().float(created.note.id);
      stickyLocks().grant(created.note.id);
    }
    return created;
  });
  router.register('lock:setPin', (req) => stickyLocks().setPin(req));
  router.register('sticky:lockStatus', (req, ctx) => stickyLocks().status(req.noteId, ctx.webContentsId));
  router.register('sticky:reveal', (req, ctx) => stickyLocks().reveal(req.noteId, ctx.webContentsId, req.with));
  router.register('sticky:activity', (req, ctx) => {
    stickyLocks().activity(req.noteId, ctx.webContentsId);
    return {};
  });
  router.register('sticky:blur', (req, ctx) => stickyLocks().blur(req.noteId, ctx.webContentsId));
  router.register('sticky:setPin', async (req, ctx) => {
    await stickyLocks().setPin(req);
    return stickyLocks().status(req.noteId, ctx.webContentsId);
  });
}
