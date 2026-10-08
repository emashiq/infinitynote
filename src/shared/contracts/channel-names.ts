// String constants only. Imported by the preload, so it must stay free of zod and Node.
export const INVOKE_CHANNELS = [
  'app:getInfo',
  'app:showDataFolder',
  'app:quit',
  'settings:get',
  'settings:set',
  'capabilities:get',
] as const;

export const EVENT_CHANNELS = ['settings:changed'] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
export type EventChannel = (typeof EVENT_CHANNELS)[number];
