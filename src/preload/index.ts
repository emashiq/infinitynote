import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { InfinityBridge } from '../shared/contracts/bridge';
import { LINK_MESSAGES } from '../shared/attachments/link-messages';
import { EVENT_CHANNELS, type EventChannel, type InvokeChannel } from '../shared/contracts/channel-names';
import { fail } from '../shared/contracts/envelope';

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

/**
 * The path of a file on disk that the user dropped or pasted; empty for clipboard data, for a File made by page script
 * and for anything else. It never reaches page script: only fileLink:create receives it (D-115).
 */
function diskPath(file: unknown): string {
  return file instanceof File ? webUtils.getPathForFile(file) : '';
}

const bridge: InfinityBridge = {
  app: {
    getInfo: call('app:getInfo'),
    showDataFolder: call('app:showDataFolder'),
    quit: call('app:quit'),
    flushed: call('app:flushed'),
  },
  attachment: {
    importBytes: call('attachment:importBytes'),
    pickFiles: call('attachment:pickFiles'),
    addPicked: call('attachment:addPicked'),
    open: call('attachment:open'),
    showInFolder: call('attachment:showInFolder'),
  },
  fileLink: {
    createFromFile: (file) => {
      const path = diskPath(file);
      return path === '' ? Promise.resolve(fail('VALIDATION_FAILED', LINK_MESSAGES.noPath)) : ipcRenderer.invoke('fileLink:create', { path });
    },
    isOnDisk: (file) => diskPath(file) !== '',
    status: call('fileLink:status'),
    open: call('fileLink:open'),
    showInFolder: call('fileLink:showInFolder'),
    copyIn: call('fileLink:copyIn'),
  },
  lock: {
    availability: call('lock:availability'),
    status: call('lock:status'),
    set: call('lock:set'),
    unlock: call('lock:unlock'),
    unlockHello: call('lock:unlockHello'),
    lockNow: call('lock:lockNow'),
    lockAll: call('lock:lockAll'),
    changePassword: call('lock:changePassword'),
    setHello: call('lock:setHello'),
    remove: call('lock:remove'),
    create: call('lock:create'),
    setPin: call('lock:setPin'),
  },
  document: {
    create: call('document:create'),
    pickFiles: call('document:pickFiles'),
    addPicked: call('document:addPicked'),
    fromAttachment: call('document:fromAttachment'),
    fromLink: call('document:fromLink'),
    open: call('document:open'),
    save: call('document:save'),
    saveCopy: call('document:saveCopy'),
    rename: call('document:rename'),
    move: call('document:move'),
    trash: call('document:trash'),
    versions: call('document:versions'),
    restoreVersion: call('document:restoreVersion'),
    openExternal: call('document:openExternal'),
    showInFolder: call('document:showInFolder'),
    pickPdf: call('document:pickPdf'),
    createBeside: call('document:createBeside'),
    copyVersion: call('document:copyVersion'),
    exportCopy: call('document:export'),
    readWorkbook: call('document:readWorkbook'),
    saveWorkbook: call('document:saveWorkbook'),
  },
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
    print: call('note:print'),
    rename: call('note:rename'),
    move: call('note:move'),
    trash: call('note:trash'),
    setPinned: call('note:setPinned'),
    open: call('note:open'),
    save: call('note:save'),
    convertFormat: call('note:convertFormat'),
  },
  item: { setFavorite: call('item:setFavorite') },
  collab: { join: call('collab:join'), push: call('collab:push'), pull: call('collab:pull'), flush: call('collab:flush'), leave: call('collab:leave') },
  versions: { list: call('versions:list'), restore: call('versions:restore') },
  drafts: { list: call('drafts:list'), resolve: call('drafts:resolve') },
  shell: { openExternal: call('shell:openExternal') },
  trash: { list: call('trash:list'), restore: call('trash:restore'), purge: call('trash:purge') },
  home: { summary: call('home:summary') },
  session: { get: call('session:get'), set: call('session:set') },
  palette: { searchTitles: call('palette:searchTitles') },
  refs: { list: call('refs:list'), documentBacklinks: call('refs:documentBacklinks') },
  links: { search: call('links:search') },
  comments: {
    list: call('comment:list'),
    create: call('comment:create'),
    reply: call('comment:reply'),
    edit: call('comment:edit'),
    delete: call('comment:delete'),
    deleteThread: call('comment:deleteThread'),
    resolve: call('comment:resolve'),
  },
  graph: { build: call('graph:build'), local: call('graph:local') },
  notes: { pick: call('notes:pick') },
  search: { query: call('search:query') },
  tags: { list: call('tags:list'), set: call('tags:set') },
  sticky: {
    float: call('sticky:float'),
    dock: call('sticky:dock'),
    hide: call('sticky:hide'),
    setColor: call('sticky:setColor'),
    setTextColor: call('sticky:setTextColor'),
    setPinned: call('sticky:setPinned'),
    setCollapsed: call('sticky:setCollapsed'),
    remove: call('sticky:remove'),
    restore: call('sticky:restore'),
    lockStatus: call('sticky:lockStatus'),
    reveal: call('sticky:reveal'),
    activity: call('sticky:activity'),
    blur: call('sticky:blur'),
    setPin: call('sticky:setPin'),
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
    createFromSuggestion: call('reminder:createFromSuggestion'),
    updateFromSource: call('reminder:updateFromSource'),
  },
  suggestion: { dismiss: call('suggestion:dismiss'), listDismissed: call('suggestion:listDismissed') },
  reminders: { listView: call('reminders:listView'), summary: call('reminders:summary') },
  occurrence: { complete: call('occurrence:complete'), snooze: call('occurrence:snooze') },
  widget: {
    show: call('widget:show'),
    hide: call('widget:hide'),
    setPinned: call('widget:setPinned'),
    setCollapsed: call('widget:setCollapsed'),
  },
  autostart: { get: call('autostart:get'), set: call('autostart:set') },
  backup: {
    create: call('backup:create'),
    prepareRestore: call('backup:prepareRestore'),
    restore: call('backup:restore'),
    status: call('backup:status'),
    setAuto: call('backup:setAuto'),
    chooseAutoFolder: call('backup:chooseAutoFolder'),
    deleteRollback: call('backup:deleteRollback'),
  },
  export: { markdown: call('export:markdown'), noteDocument: call('export:noteDocument'), portable: call('export:portable') },
  import: { portable: call('import:portable') },
  shortcut: { getGlobal: call('shortcut:getGlobal'), setGlobal: call('shortcut:setGlobal') },
  subscribe,
};

for (const group of Object.values(bridge)) if (typeof group === 'object') Object.freeze(group);
contextBridge.exposeInMainWorld('infinity', Object.freeze(bridge));
