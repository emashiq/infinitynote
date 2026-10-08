import { z } from 'zod';
import { AppInfo, Capabilities } from './app';
import type { EventChannel, InvokeChannel } from './channel-names';
import {
  FolderCreateRequest,
  FolderIdRequest,
  FolderMoveRequest,
  FolderMoveResponse,
  FolderRenameRequest,
  FolderResponse,
  ItemSetFavoriteRequest,
  ItemSetFavoriteResponse,
  NoteCreateRequest,
  NoteIdRequest,
  NoteMoveRequest,
  NoteRenameRequest,
  NoteResponse,
  NoteSetPinnedRequest,
  ProjectCreateRequest,
  ProjectIdRequest,
  ProjectRenameRequest,
  ProjectResponse,
  TrashListResponse,
  TrashPurgeRequest,
  TrashPurgeResponse,
  TrashRestoreRequest,
  TrashRestoreResponse,
  TrashResult,
  TreeChangedEvent,
  TreeSnapshot,
} from './hierarchy';
import { HomeSummaryRequest, HomeSummaryResponse } from './home';
import {
  LeaseAcquireRequest,
  LeaseAcquireResponse,
  LeaseReleaseRequest,
  LeaseReleaseResponse,
  NoteOpenRequest,
  NoteOpenResponse,
  NoteSaveAck,
  NoteSaveRequest,
} from './notes';
import { PaletteSearchRequest, PaletteSearchResponse } from './palette';
import { SessionGetResponse, SessionSetRequest, SessionSetResponse } from './session';
import {
  SettingsChangedEvent,
  SettingsGetRequest,
  SettingsGetResponse,
  SettingsSetRequest,
  SettingsSetResponse,
} from './settings';

const Empty = z.strictObject({});

interface ChannelSchema {
  request: z.ZodType;
  response: z.ZodType;
}

export const CHANNEL_SCHEMAS = {
  'app:getInfo': { request: Empty, response: AppInfo },
  'app:showDataFolder': { request: Empty, response: z.strictObject({ opened: z.literal(true) }) },
  'app:quit': { request: Empty, response: Empty },
  'settings:get': { request: SettingsGetRequest, response: SettingsGetResponse },
  'settings:set': { request: SettingsSetRequest, response: SettingsSetResponse },
  'capabilities:get': { request: Empty, response: Capabilities },
  'tree:list': { request: Empty, response: TreeSnapshot },
  'project:create': { request: ProjectCreateRequest, response: ProjectResponse },
  'project:rename': { request: ProjectRenameRequest, response: ProjectResponse },
  'project:trash': { request: ProjectIdRequest, response: TrashResult },
  'folder:create': { request: FolderCreateRequest, response: FolderResponse },
  'folder:rename': { request: FolderRenameRequest, response: FolderResponse },
  'folder:move': { request: FolderMoveRequest, response: FolderMoveResponse },
  'folder:trash': { request: FolderIdRequest, response: TrashResult },
  'note:create': { request: NoteCreateRequest, response: NoteResponse },
  'note:rename': { request: NoteRenameRequest, response: NoteResponse },
  'note:move': { request: NoteMoveRequest, response: NoteResponse },
  'note:trash': { request: NoteIdRequest, response: TrashResult },
  'note:setPinned': { request: NoteSetPinnedRequest, response: NoteResponse },
  'item:setFavorite': { request: ItemSetFavoriteRequest, response: ItemSetFavoriteResponse },
  'trash:list': { request: Empty, response: TrashListResponse },
  'trash:restore': { request: TrashRestoreRequest, response: TrashRestoreResponse },
  'trash:purge': { request: TrashPurgeRequest, response: TrashPurgeResponse },
  'home:summary': { request: HomeSummaryRequest, response: HomeSummaryResponse },
  'session:get': { request: Empty, response: SessionGetResponse },
  'session:set': { request: SessionSetRequest, response: SessionSetResponse },
  'palette:searchTitles': { request: PaletteSearchRequest, response: PaletteSearchResponse },
  'note:open': { request: NoteOpenRequest, response: NoteOpenResponse },
  'note:save': { request: NoteSaveRequest, response: NoteSaveAck },
  'lease:acquire': { request: LeaseAcquireRequest, response: LeaseAcquireResponse },
  'lease:release': { request: LeaseReleaseRequest, response: LeaseReleaseResponse },
} as const satisfies Record<InvokeChannel, ChannelSchema>;

export const EVENT_SCHEMAS = {
  'settings:changed': SettingsChangedEvent,
  'tree:changed': TreeChangedEvent,
} as const satisfies Record<EventChannel, z.ZodType>;

type ChannelSchemas = typeof CHANNEL_SCHEMAS;

/** What a renderer sends on an invoke channel (before main parses it). */
export type ChannelInput<C extends InvokeChannel> = z.input<ChannelSchemas[C]['request']>;
/** The parsed request a main-process handler receives. */
export type ChannelRequest<C extends InvokeChannel> = z.output<ChannelSchemas[C]['request']>;
/** The data a handler returns and the renderer receives. */
export type ChannelResponse<C extends InvokeChannel> = z.output<ChannelSchemas[C]['response']>;
/** The payload of a main-to-renderer event. */
export type EventPayload<C extends EventChannel> = z.output<(typeof EVENT_SCHEMAS)[C]>;
