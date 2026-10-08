// String constants only. Imported by the preload, so it must stay free of zod and Node.
export const INVOKE_CHANNELS = [
  'app:getInfo',
  'app:showDataFolder',
  'app:quit',
  'settings:get',
  'settings:set',
  'capabilities:get',
  'tree:list',
  'project:create',
  'project:rename',
  'project:trash',
  'folder:create',
  'folder:rename',
  'folder:move',
  'folder:trash',
  'note:create',
  'note:rename',
  'note:move',
  'note:trash',
  'note:setPinned',
  'item:setFavorite',
  'trash:list',
  'trash:restore',
  'trash:purge',
  'home:summary',
  'session:get',
  'session:set',
  'palette:searchTitles',
  'note:open',
  'note:save',
  'lease:acquire',
  'lease:release',
] as const;

export const EVENT_CHANNELS = ['settings:changed', 'tree:changed'] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
export type EventChannel = (typeof EVENT_CHANNELS)[number];
