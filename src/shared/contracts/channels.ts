import { z } from 'zod';
import { AppInfo, Capabilities } from './app';
import type { EventChannel, InvokeChannel } from './channel-names';
import {
  SettingsChangedEvent,
  SettingsGetRequest,
  SettingsGetResponse,
  SettingsSetRequest,
  SettingsSetResponse,
} from './settings';

const Empty = z.strictObject({});

export interface ChannelSchema {
  request: z.ZodType;
  response: z.ZodType;
}

export const CHANNEL_SCHEMAS: Record<InvokeChannel, ChannelSchema> = {
  'app:getInfo': { request: Empty, response: AppInfo },
  'app:showDataFolder': { request: Empty, response: z.strictObject({ opened: z.literal(true) }) },
  'app:quit': { request: Empty, response: Empty },
  'settings:get': { request: SettingsGetRequest, response: SettingsGetResponse },
  'settings:set': { request: SettingsSetRequest, response: SettingsSetResponse },
  'capabilities:get': { request: Empty, response: Capabilities },
};

export const EVENT_SCHEMAS: Record<EventChannel, z.ZodType> = {
  'settings:changed': SettingsChangedEvent,
};
