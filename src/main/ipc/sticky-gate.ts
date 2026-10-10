import { STICKY_CONTENT_CHANNELS } from '../../shared/contracts/channel-roles';
import type { InvokeChannel } from '../../shared/contracts/channel-names';
import type { StickyLockService } from '../locks/sticky-locks';
import type { Handler, IpcRouter } from './router';

/**
 * A router whose content channels answer a sticky window only while main shows it its note (D-172): for a locked note
 * that is while the note is revealed in that window. The check runs in main before the handler, so a renderer that
 * skips its own blur still gets nothing.
 */
export function gateStickyContent(router: IpcRouter, stickyLocks: () => Pick<StickyLockService, 'assertRevealed'> | null): IpcRouter {
  return {
    register<C extends InvokeChannel>(channel: C, handler: Handler<C>, options?: Parameters<IpcRouter['register']>[2]) {
      if (!STICKY_CONTENT_CHANNELS.has(channel)) {
        router.register(channel, handler, options);
        return;
      }
      const gated: Handler<C> = (request, ctx) => {
        if (ctx.sender.role === 'sticky') stickyLocks()?.assertRevealed(ctx.sender.noteId, ctx.webContentsId);
        return handler(request, ctx);
      };
      router.register(channel, gated, options);
    },
    dispose: () => router.dispose(),
  };
}
