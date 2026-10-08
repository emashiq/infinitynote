import { EVENT_CHANNELS, type EventChannel } from '../../shared/contracts/channel-names';
import type { EventPayload } from '../../shared/contracts/channels';
import type { WindowRegistry } from '../windows/window-registry';

export interface EventBus {
  /** Sends to every registered window. */
  broadcast<C extends EventChannel>(channel: C, payload: EventPayload<C>): void;
  /** Sends to one registered window; false when it is not registered or already destroyed. */
  sendTo<C extends EventChannel>(webContentsId: number, channel: C, payload: EventPayload<C>): boolean;
}

function assertCatalogued(channel: string): void {
  if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) throw new Error(`Unknown event channel: ${channel}`);
}

export function createEventBus(registry: WindowRegistry): EventBus {
  return {
    broadcast(channel, payload) {
      assertCatalogued(channel);
      for (const win of registry.all()) {
        if (!win.isDestroyed()) win.send(channel, payload);
      }
    },
    sendTo(webContentsId, channel, payload) {
      assertCatalogued(channel);
      const win = registry.get(webContentsId);
      if (!win || win.isDestroyed()) return false;
      win.send(channel, payload);
      return true;
    },
  };
}
