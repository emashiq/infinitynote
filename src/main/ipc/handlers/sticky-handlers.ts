import type { StickyManager } from '../../windows/sticky-manager';
import type { IpcRouter } from '../router';

/** Sticky window channels (D-063). The router already limits a sticky window to its own note (D-064). */
export function registerStickyHandlers(router: IpcRouter, stickies: () => StickyManager): void {
  router.register('sticky:float', (req) => stickies().float(req.noteId));
  router.register('sticky:dock', async (req) => {
    await stickies().dock(req.noteId);
    return {};
  });
  router.register('sticky:hide', async (req) => {
    await stickies().hide(req.noteId);
    return {};
  });
  router.register('sticky:setColor', (req) => stickies().setColor(req.noteId, req.color));
  router.register('sticky:setPinned', (req) => stickies().setPinned(req.noteId, req.pinned));
  router.register('sticky:setCollapsed', (req) => stickies().setCollapsed(req.noteId, req.collapsed));
  router.register('sticky:remove', async (req) => {
    await stickies().remove(req.noteId);
    return {};
  });
  router.register('sticky:restore', (req) => stickies().restore(req.noteId));
}
