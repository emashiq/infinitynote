import { contextBridge, ipcRenderer } from 'electron';
import type { InfinityBridge } from '../shared/contracts/bridge';
import { EVENT_CHANNELS, type EventChannel, type InvokeChannel } from '../shared/contracts/channel-names';

function invoke<T>(channel: InvokeChannel, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>;
}

function subscribe(channel: EventChannel, cb: (payload: unknown) => void): () => void {
  if (typeof channel !== 'string' || !(EVENT_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error('Unknown event channel');
  }
  if (typeof cb !== 'function') throw new Error('Callback must be a function');
  const listener = (_event: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

type SettingsApi = InfinityBridge['settings'];

const bridge: InfinityBridge = Object.freeze({
  app: Object.freeze({
    getInfo: () => invoke('app:getInfo', {}),
    showDataFolder: () => invoke('app:showDataFolder', {}),
    quit: () => invoke('app:quit', {}),
  }),
  settings: Object.freeze({
    get: ((req) => invoke('settings:get', req)) as SettingsApi['get'],
    set: ((req) => invoke('settings:set', req)) as SettingsApi['set'],
  }),
  capabilities: Object.freeze({
    get: () => invoke('capabilities:get', {}),
  }),
  subscribe,
}) as InfinityBridge;

contextBridge.exposeInMainWorld('infinity', bridge);
