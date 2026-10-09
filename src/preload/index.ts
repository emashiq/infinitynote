import { contextBridge, ipcRenderer } from 'electron';
import type { InfinityBridge } from '../shared/contracts/bridge';
import { EVENT_CHANNELS, type EventChannel, type InvokeChannel } from '../shared/contracts/channel-names';

/**
 * One bridge method per channel. Main validates every payload, so the preload only forwards it; the return
 * type is inferred from the InfinityBridge method the call is assigned to.
 */
function call<A extends [unknown?], R>(channel: InvokeChannel): (...args: A) => Promise<R> {
  return (...args) => ipcRenderer.invoke(channel, args[0] ?? {}) as Promise<R>;
}

function subscribe(channel: EventChannel, cb: (payload: never) => void): () => void {
  if (typeof channel !== 'string' || !(EVENT_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error('Unknown event channel');
  }
  if (typeof cb !== 'function') throw new Error('Callback must be a function');
  const listener = (_event: unknown, payload: unknown) => cb(payload as never);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const bridge: InfinityBridge = {
  app: {
    getInfo: call('app:getInfo'),
    showDataFolder: call('app:showDataFolder'),
    quit: call('app:quit'),
    flushed: call('app:flushed'),
  },
  attachment: { importBytes: call('attachment:importBytes'), importFromDialog: call('attachment:importFromDialog') },
  settings: { get: call('settings:get'), set: call('settings:set') },
  capabilities: { get: call('capabilities:get') },
  tree: { list: call('tree:list') },
  project: { create: call('project:create'), rename: call('project:rename'), trash: call('project:trash') },
  folder: {
    create: call('folder:create'),
    rename: call('folder:rename'),
    move: call('folder:move'),
    trash: call('folder:trash'),
  },
  note: {
    create: call('note:create'),
    rename: call('note:rename'),
    move: call('note:move'),
    trash: call('note:trash'),
    setPinned: call('note:setPinned'),
    open: call('note:open'),
    save: call('note:save'),
    convertFormat: call('note:convertFormat'),
  },
  item: { setFavorite: call('item:setFavorite') },
  lease: { acquire: call('lease:acquire'), release: call('lease:release'), take: call('lease:take') },
  versions: { list: call('versions:list'), restore: call('versions:restore') },
  drafts: { list: call('drafts:list'), resolve: call('drafts:resolve') },
  shell: { openExternal: call('shell:openExternal') },
  trash: { list: call('trash:list'), restore: call('trash:restore'), purge: call('trash:purge') },
  home: { summary: call('home:summary') },
  session: { get: call('session:get'), set: call('session:set') },
  palette: { searchTitles: call('palette:searchTitles') },
  sticky: {
    float: call('sticky:float'),
    dock: call('sticky:dock'),
    hide: call('sticky:hide'),
    setColor: call('sticky:setColor'),
    setPinned: call('sticky:setPinned'),
    setCollapsed: call('sticky:setCollapsed'),
    remove: call('sticky:remove'),
    restore: call('sticky:restore'),
  },
  window: { getState: call('window:getState') },
  zones: { list: call('zones:list') },
  reminder: {
    create: call('reminder:create'),
    update: call('reminder:update'),
    delete: call('reminder:delete'),
    undoDelete: call('reminder:undoDelete'),
    listForNote: call('reminder:listForNote'),
    open: call('reminder:open'),
  },
  reminders: { listView: call('reminders:listView'), summary: call('reminders:summary') },
  occurrence: { complete: call('occurrence:complete'), snooze: call('occurrence:snooze') },
  widget: {
    show: call('widget:show'),
    hide: call('widget:hide'),
    setPinned: call('widget:setPinned'),
    setCollapsed: call('widget:setCollapsed'),
  },
  autostart: { get: call('autostart:get'), set: call('autostart:set') },
  subscribe,
};

for (const group of Object.values(bridge)) if (typeof group === 'object') Object.freeze(group);
contextBridge.exposeInMainWorld('infinity', Object.freeze(bridge));
