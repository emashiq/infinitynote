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
    importFromDialog: Call<'attachment:importFromDialog'>;
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
  readonly lease: {
    acquire: Call<'lease:acquire'>;
    release: Call<'lease:release'>;
    take: Call<'lease:take'>;
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
  readonly sticky: {
    float: Call<'sticky:float'>;
    dock: Call<'sticky:dock'>;
    hide: Call<'sticky:hide'>;
    setColor: Call<'sticky:setColor'>;
    setPinned: Call<'sticky:setPinned'>;
    setCollapsed: Call<'sticky:setCollapsed'>;
    remove: Call<'sticky:remove'>;
    restore: Call<'sticky:restore'>;
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
  subscribe<C extends EventChannel>(channel: C, cb: (payload: EventPayload<C>) => void): () => void;
}
