import type { EventChannel, InvokeChannel } from './channel-names';
import type { ChannelInput, ChannelResponse, EventPayload } from './channels';
import type { Result } from './envelope';
import type { PublicSettingKey, SettingValue, SettingsChangedPayload } from './settings';

type Res<T> = Promise<Result<T>>;

/** A bridge method for a channel that takes a request object. */
type Call<C extends InvokeChannel> = (req: ChannelInput<C>) => Res<ChannelResponse<C>>;
/** A bridge method for a channel whose request is empty. */
type Query<C extends InvokeChannel> = () => Res<ChannelResponse<C>>;

export type SettingsSetArgs = {
  [K in PublicSettingKey]: { key: K; value: SettingValue<K> };
}[PublicSettingKey];

/** The `window.infinity` surface exposed by the preload (D-045). Request and response types come from CHANNEL_SCHEMAS. */
export interface InfinityBridge {
  readonly app: {
    getInfo: Query<'app:getInfo'>;
    showDataFolder: Query<'app:showDataFolder'>;
    quit: Query<'app:quit'>;
    flushed: Call<'app:flushed'>;
  };
  readonly attachment: {
    importBytes: Call<'attachment:importBytes'>;
    pickFiles: Call<'attachment:pickFiles'>;
    addPicked: Call<'attachment:addPicked'>;
    open: Call<'attachment:open'>;
    showInFolder: Call<'attachment:showInFolder'>;
  };
  /**
   * Files linked at their original location (D-108). Page script never names or sees a path to link: the preload reads
   * it from a File the user dropped or pasted (webUtils.getPathForFile), which page script cannot forge (D-115).
   */
  readonly fileLink: {
    /** Links a dropped or pasted file on disk; refused for clipboard data and for a File made by page script. */
    createFromFile(file: File): Res<ChannelResponse<'fileLink:create'>>;
    /** Whether a dropped or pasted file is on disk, so it can be linked. */
    isOnDisk(file: File): boolean;
    status: Call<'fileLink:status'>;
    open: Call<'fileLink:open'>;
    showInFolder: Call<'fileLink:showInFolder'>;
    copyIn: Call<'fileLink:copyIn'>;
  };
  /** Locked notes (D-111..D-113): passwords go only to main, in these requests. */
  readonly lock: {
    availability: Query<'lock:availability'>;
    status: Call<'lock:status'>;
    set: Call<'lock:set'>;
    unlock: Call<'lock:unlock'>;
    unlockHello: Call<'lock:unlockHello'>;
    lockNow: Call<'lock:lockNow'>;
    lockAll: Query<'lock:lockAll'>;
    changePassword: Call<'lock:changePassword'>;
    setHello: Call<'lock:setHello'>;
    remove: Call<'lock:remove'>;
    create: Call<'lock:create'>;
    setPin: Call<'lock:setPin'>;
  };
  /** Documents (D-118): main window only; bytes are read through the document protocol, never through IPC. */
  readonly document: {
    create: Call<'document:create'>;
    pickFiles: Query<'document:pickFiles'>;
    addPicked: Call<'document:addPicked'>;
    fromAttachment: Call<'document:fromAttachment'>;
    fromLink: Call<'document:fromLink'>;
    open: Call<'document:open'>;
    save: Call<'document:save'>;
    saveCopy: Call<'document:saveCopy'>;
    rename: Call<'document:rename'>;
    move: Call<'document:move'>;
    trash: Call<'document:trash'>;
    versions: Call<'document:versions'>;
    restoreVersion: Call<'document:restoreVersion'>;
    openExternal: Call<'document:openExternal'>;
    showInFolder: Call<'document:showInFolder'>;
    pickPdf: Query<'document:pickPdf'>;
    createBeside: Call<'document:createBeside'>;
    copyVersion: Call<'document:copyVersion'>;
    exportCopy: Call<'document:export'>;
    readWorkbook: Call<'document:readWorkbook'>;
    saveWorkbook: Call<'document:saveWorkbook'>;
  };
  readonly settings: {
    get(req: { keys: PublicSettingKey[] }): Res<{ values: Partial<{ [K in PublicSettingKey]: SettingValue<K> }> }>;
    set(req: SettingsSetArgs): Res<SettingsChangedPayload>;
  };
  readonly capabilities: {
    get: Query<'capabilities:get'>;
  };
  readonly tree: {
    list: Query<'tree:list'>;
  };
  readonly project: {
    create: Call<'project:create'>;
    rename: Call<'project:rename'>;
    trash: Call<'project:trash'>;
  };
  readonly folder: {
    create: Call<'folder:create'>;
    rename: Call<'folder:rename'>;
    move: Call<'folder:move'>;
    trash: Call<'folder:trash'>;
  };
  readonly note: {
    create: Call<'note:create'>;
    print: Call<'note:print'>;
    rename: Call<'note:rename'>;
    move: Call<'note:move'>;
    trash: Call<'note:trash'>;
    setPinned: Call<'note:setPinned'>;
    open: Call<'note:open'>;
    save: Call<'note:save'>;
    convertFormat: Call<'note:convertFormat'>;
  };
  readonly item: {
    setFavorite: Call<'item:setFavorite'>;
  };
  /** Live sync of a note between its views (D-103). */
  readonly collab: {
    join: Call<'collab:join'>;
    push: Call<'collab:push'>;
    pull: Call<'collab:pull'>;
    flush: Call<'collab:flush'>;
    leave: Call<'collab:leave'>;
  };
  readonly versions: {
    list: Call<'versions:list'>;
    restore: Call<'versions:restore'>;
  };
  readonly drafts: {
    list: Call<'drafts:list'>;
    resolve: Call<'drafts:resolve'>;
  };
  readonly shell: {
    openExternal: Call<'shell:openExternal'>;
  };
  readonly trash: {
    list: Query<'trash:list'>;
    restore: Call<'trash:restore'>;
    purge: Call<'trash:purge'>;
  };
  readonly home: {
    summary: Call<'home:summary'>;
  };
  readonly session: {
    get: Query<'session:get'>;
    set: Call<'session:set'>;
  };
  readonly palette: {
    searchTitles: Call<'palette:searchTitles'>;
  };
  readonly refs: {
    list: Call<'refs:list'>;
    documentBacklinks: Call<'refs:documentBacklinks'>;
  };
  readonly links: {
    search: Call<'links:search'>;
  };
  readonly comments: {
    list: Call<'comment:list'>;
    create: Call<'comment:create'>;
    reply: Call<'comment:reply'>;
    edit: Call<'comment:edit'>;
    delete: Call<'comment:delete'>;
    deleteThread: Call<'comment:deleteThread'>;
    resolve: Call<'comment:resolve'>;
  };
  readonly graph: {
    build: Call<'graph:build'>;
    local: Call<'graph:local'>;
  };
  readonly notes: {
    pick: Call<'notes:pick'>;
  };
  readonly search: {
    query: Call<'search:query'>;
  };
  readonly tags: {
    list: Call<'tags:list'>;
    set: Call<'tags:set'>;
  };
  readonly sticky: {
    float: Call<'sticky:float'>;
    dock: Call<'sticky:dock'>;
    hide: Call<'sticky:hide'>;
    setColor: Call<'sticky:setColor'>;
    setTextColor: Call<'sticky:setTextColor'>;
    setPinned: Call<'sticky:setPinned'>;
    setCollapsed: Call<'sticky:setCollapsed'>;
    remove: Call<'sticky:remove'>;
    restore: Call<'sticky:restore'>;
    lockStatus: Call<'sticky:lockStatus'>;
    reveal: Call<'sticky:reveal'>;
    activity: Call<'sticky:activity'>;
    blur: Call<'sticky:blur'>;
    setPin: Call<'sticky:setPin'>;
  };
  readonly window: {
    getState: Query<'window:getState'>;
  };
  readonly zones: {
    list: Query<'zones:list'>;
  };
  readonly reminder: {
    create: Call<'reminder:create'>;
    update: Call<'reminder:update'>;
    delete: Call<'reminder:delete'>;
    undoDelete: Call<'reminder:undoDelete'>;
    listForNote: Call<'reminder:listForNote'>;
    open: Call<'reminder:open'>;
    createFromSuggestion: Call<'reminder:createFromSuggestion'>;
    updateFromSource: Call<'reminder:updateFromSource'>;
  };
  readonly suggestion: {
    dismiss: Call<'suggestion:dismiss'>;
    listDismissed: Call<'suggestion:listDismissed'>;
  };
  readonly reminders: {
    listView: Call<'reminders:listView'>;
    summary: Call<'reminders:summary'>;
  };
  readonly occurrence: {
    complete: Call<'occurrence:complete'>;
    snooze: Call<'occurrence:snooze'>;
  };
  readonly widget: {
    show: Query<'widget:show'>;
    hide: Query<'widget:hide'>;
    setPinned: Call<'widget:setPinned'>;
    setCollapsed: Call<'widget:setCollapsed'>;
  };
  readonly autostart: {
    get: Query<'autostart:get'>;
    set: Call<'autostart:set'>;
  };
  readonly backup: {
    create: Query<'backup:create'>;
    prepareRestore: Query<'backup:prepareRestore'>;
    restore: Query<'backup:restore'>;
    status: Query<'backup:status'>;
    setAuto: Call<'backup:setAuto'>;
    chooseAutoFolder: Query<'backup:chooseAutoFolder'>;
    deleteRollback: Query<'backup:deleteRollback'>;
  };
  readonly export: {
    markdown: Call<'export:markdown'>;
    noteDocument: Call<'export:noteDocument'>;
    portable: Query<'export:portable'>;
  };
  readonly import: {
    portable: Query<'import:portable'>;
  };
  readonly shortcut: {
    getGlobal: Query<'shortcut:getGlobal'>;
    setGlobal: Call<'shortcut:setGlobal'>;
  };
  subscribe<C extends EventChannel>(channel: C, cb: (payload: EventPayload<C>) => void): () => void;
}
