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

const call0 = (channel: InvokeChannel) => () => invoke(channel, {});
const call = (channel: InvokeChannel) => (req?: unknown) => invoke(channel, req ?? {});

const bridge = Object.freeze({
  app: Object.freeze({
    getInfo: call0('app:getInfo'),
    showDataFolder: call0('app:showDataFolder'),
    quit: call0('app:quit'),
  }),
  settings: Object.freeze({ get: call('settings:get'), set: call('settings:set') }),
  capabilities: Object.freeze({ get: call0('capabilities:get') }),
  tree: Object.freeze({ list: call0('tree:list') }),
  project: Object.freeze({ create: call('project:create'), rename: call('project:rename'), trash: call('project:trash') }),
  folder: Object.freeze({
    create: call('folder:create'),
    rename: call('folder:rename'),
    move: call('folder:move'),
    trash: call('folder:trash'),
  }),
  note: Object.freeze({
    create: call('note:create'),
    rename: call('note:rename'),
    move: call('note:move'),
    trash: call('note:trash'),
    setPinned: call('note:setPinned'),
    open: call('note:open'),
    save: call('note:save'),
  }),
  item: Object.freeze({ setFavorite: call('item:setFavorite') }),
  lease: Object.freeze({ acquire: call('lease:acquire'), release: call('lease:release') }),
  trash: Object.freeze({ list: call0('trash:list'), restore: call('trash:restore'), purge: call('trash:purge') }),
  home: Object.freeze({ summary: call('home:summary') }),
  session: Object.freeze({ get: call0('session:get'), set: call('session:set') }),
  palette: Object.freeze({ searchTitles: call('palette:searchTitles') }),
  subscribe,
}) as unknown as InfinityBridge;

contextBridge.exposeInMainWorld('infinity', bridge);
