import { EVENT_CHANNELS, type EventChannel } from '../../shared/contracts/channel-names';
import type { WindowRegistry } from '../windows/window-registry';

export interface EventBus {
  broadcast(channel: EventChannel, payload: unknown): void;
}

export function createEventBus(registry: WindowRegistry): EventBus {
  return {
    broadcast(channel, payload) {
      if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) {
        throw new Error(`Unknown event channel: ${channel}`);
      }
      for (const win of registry.all()) {
        if (!win.isDestroyed()) win.send(channel, payload);
      }
    },
  };
}
