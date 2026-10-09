import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { registerIpcHandlers, type DesktopHandlerDeps } from '../../src/main/ipc/register-handlers';
import { createIpcRouter, type IpcMainLike } from '../../src/main/ipc/router';
import { createSenderPolicy, type IpcEventLike } from '../../src/main/ipc/sender-policy';
import type { MainServices } from '../../src/main/main-services';
import { memoryLogger } from '../../src/main/services/logger';
import type { SenderInfo } from '../../src/main/windows/window-registry';
import type { Result } from '../../src/shared/contracts/envelope';

type Listener = (event: IpcEventLike, payload: unknown) => unknown;

/** An invoke from the top-level frame of registered window 1 on the renderer origin. */
export function rendererEvent(over: Partial<IpcEventLike> = {}): IpcEventLike {
  return { sender: { id: 1 }, senderFrame: { url: 'infinity-app://renderer/index.html#/', parent: null }, ...over };
}

/** In-memory ipcMain: records handlers (refusing duplicates like Electron) and invokes them directly. */
export function fakeIpcMain() {
  const handlers = new Map<string, Listener>();
  const ipcMain: IpcMainLike = {
    handle: (channel, listener) => {
      if (handlers.has(channel)) throw new Error(`duplicate handler ${channel}`);
      handlers.set(channel, listener);
    },
    removeHandler: (channel) => {
      handlers.delete(channel);
    },
  };
  const call = async <T = unknown>(channel: string, payload: unknown, event: IpcEventLike = rendererEvent()): Promise<Result<T>> => {
    const listener = handlers.get(channel);
    if (!listener) throw new Error(`no handler for ${channel}`);
    return (await listener(event, payload)) as Result<T>;
  };
  return { handlers, ipcMain, call };
}

/** Loosely typed on purpose: the tests read many differently shaped response bodies. */
export interface Loose {
  ok: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  error?: { code: string; message: string; details?: unknown };
}

/** Windows 1 and 2 are main windows; window 3 is the sticky window of `stickyNoteId` when one is given; window 4 is the widget. */
export function rolesRegistry(stickyNoteId?: string) {
  return {
    info(wcId: number): SenderInfo | undefined {
      if (wcId === 1 || wcId === 2) return { role: 'main' };
      if (wcId === 3 && stickyNoteId) return { role: 'sticky', noteId: stickyNoteId };
      if (wcId === 4) return { role: 'widget' };
      return undefined;
    },
  };
}

/** A windows side without a main window renderer that is ready and without stickies. */
export const NO_DESKTOP: DesktopHandlerDeps = {
  mainWindow: { rendererReady: () => ({ openNotes: [], openReminders: null }), openNote: () => undefined },
  stickies: null,
  widget: null,
  autostart: { get: () => ({ enabled: false, capability: { status: 'unsupported', reason: 'development-build' } }), set: () => { throw new Error('not used'); } },
};

/**
 * Every catalogue channel registered through registerIpcHandlers, as main does at startup, with response
 * validation on. Windows 1 and 2 are main windows; window 3 is a sticky window when `stickyNoteId` is given; window 4
 * is the widget.
 */
export function catalogueRouter(services: MainServices | null, app: AppHandlerDeps, opts: { stickyNoteId?: string; desktop?: DesktopHandlerDeps } = {}) {
  const ipc = fakeIpcMain();
  const router = createIpcRouter({
    ipcMain: ipc.ipcMain,
    senderPolicy: createSenderPolicy({ registry: rolesRegistry(opts.stickyNoteId) }),
    logger: memoryLogger(),
    validateResponses: true,
  });
  registerIpcHandlers(router, { app, services, desktop: opts.desktop ?? NO_DESKTOP });
  const call = async (channel: string, payload: unknown, fromWebContents = 1): Promise<Loose> =>
    (await ipc.call(channel, payload, rendererEvent({ sender: { id: fromWebContents } }))) as Loose;
  return { handlers: ipc.handlers, call, router };
}
