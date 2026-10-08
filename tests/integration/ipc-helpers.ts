import type { IpcMainLike } from '../../src/main/ipc/router';
import type { IpcEventLike } from '../../src/main/ipc/sender-policy';
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
