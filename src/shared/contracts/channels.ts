import { z } from 'zod';
import { AppFlushedRequest, AppFlushRequestEvent, AppInfo, Capabilities, ShellOpenExternalRequest, ShellOpenExternalResponse } from './app';
import {
  AttachmentHandoffRequest,
  AttachmentImportBytesRequest,
  AttachmentImportBytesResponse,
  AttachmentImportDialogRequest,
  AttachmentImportDialogResponse,
  AttachmentOpenResponse,
  AttachmentShowResponse,
} from './attachments';
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
  DraftsListRequest,
  DraftsListResponse,
  DraftsResolveRequest,
  DraftsResolveResponse,
  LeaseAcquireRequest,
  LeaseAcquireResponse,
  LeaseReleaseRequest,
  LeaseReleaseRequestEvent,
  LeaseReleaseResponse,
  LeaseTakeRequest,
  LeaseTakeResponse,
  NoteContentResponse,
  NoteConvertRequest,
  NoteLeaseEvent,
  NoteOpenRequest,
  NoteOpenResponse,
  NoteRevisionEvent,
  NoteSaveAck,
  NoteSaveRequest,
  VersionsListRequest,
  VersionsListResponse,
  VersionsRestoreRequest,
} from './notes';
import { PaletteSearchRequest, PaletteSearchResponse } from './palette';
import { NotesPickRequest, NotesPickResponse, RefsListRequest, RefsListResponse } from './references';
import { SearchQueryRequest, SearchQueryResponse } from './search';
import { TagsListRequest, TagsListResponse, TagsSetRequest, TagsSetResponse } from './tags';
import {
  AppOpenRemindersEvent,
  OccurrenceIdRequest,
  OccurrenceItem,
  OccurrenceSnoozeRequest,
  ReminderAlertEvent,
  ReminderChangedEvent,
  ReminderCreateRequest,
  ReminderDeleteResponse,
  ReminderDto,
  ReminderIdRequest,
  ReminderListForNoteRequest,
  ReminderListResponse,
  ReminderUpdateRequest,
  ReminderViewResponse,
  RemindersListViewRequest,
  RemindersSummaryRequest,
  RemindersSummaryResponse,
  ZonesListResponse,
} from './reminders';
import { SessionGetResponse, SessionSetRequest, SessionSetResponse } from './session';
import {
  ReminderCreateFromSuggestionRequest,
  ReminderCreateFromSuggestionResponse,
  ReminderUpdateFromSourceRequest,
  SuggestionDismissRequest,
  SuggestionDismissResponse,
  SuggestionListDismissedRequest,
  SuggestionListDismissedResponse,
} from './suggestions';
import {
  StickyFloatResponse,
  StickyNoteRequest,
  StickySetCollapsedRequest,
  StickySetColorRequest,
  StickySetPinnedRequest,
  StickyState,
} from './stickies';
import { AppOpenNoteEvent, WindowGetStateResponse } from './windows';
import { AutostartSetRequest, AutostartState, WidgetSetCollapsedRequest, WidgetSetPinnedRequest, WidgetState } from './widget';
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
  'lease:take': { request: LeaseTakeRequest, response: LeaseTakeResponse },
  'note:convertFormat': { request: NoteConvertRequest, response: NoteContentResponse },
  'versions:list': { request: VersionsListRequest, response: VersionsListResponse },
  'versions:restore': { request: VersionsRestoreRequest, response: NoteContentResponse },
  'drafts:list': { request: DraftsListRequest, response: DraftsListResponse },
  'drafts:resolve': { request: DraftsResolveRequest, response: DraftsResolveResponse },
  'attachment:importBytes': { request: AttachmentImportBytesRequest, response: AttachmentImportBytesResponse },
  'attachment:importFromDialog': { request: AttachmentImportDialogRequest, response: AttachmentImportDialogResponse },
  'shell:openExternal': { request: ShellOpenExternalRequest, response: ShellOpenExternalResponse },
  'app:flushed': { request: AppFlushedRequest, response: Empty },
  'sticky:float': { request: StickyNoteRequest, response: StickyFloatResponse },
  'sticky:dock': { request: StickyNoteRequest, response: Empty },
  'sticky:hide': { request: StickyNoteRequest, response: Empty },
  'sticky:setColor': { request: StickySetColorRequest, response: StickyState.nullable() },
  'sticky:setPinned': { request: StickySetPinnedRequest, response: StickyState },
  'sticky:setCollapsed': { request: StickySetCollapsedRequest, response: StickyState },
  'sticky:remove': { request: StickyNoteRequest, response: Empty },
  'sticky:restore': { request: StickyNoteRequest, response: TrashRestoreResponse },
  'window:getState': { request: Empty, response: WindowGetStateResponse },
  'zones:list': { request: Empty, response: ZonesListResponse },
  'reminder:create': { request: ReminderCreateRequest, response: ReminderDto },
  'reminder:update': { request: ReminderUpdateRequest, response: ReminderDto },
  'reminder:delete': { request: ReminderIdRequest, response: ReminderDeleteResponse },
  'reminder:undoDelete': { request: ReminderIdRequest, response: ReminderDto },
  'reminder:listForNote': { request: ReminderListForNoteRequest, response: ReminderListResponse },
  'reminder:open': { request: ReminderIdRequest, response: Empty },
  'reminders:listView': { request: RemindersListViewRequest, response: ReminderViewResponse },
  'reminders:summary': { request: RemindersSummaryRequest, response: RemindersSummaryResponse },
  'occurrence:complete': { request: OccurrenceIdRequest, response: OccurrenceItem },
  'occurrence:snooze': { request: OccurrenceSnoozeRequest, response: OccurrenceItem },
  'widget:show': { request: Empty, response: WidgetState },
  'widget:hide': { request: Empty, response: WidgetState },
  'widget:setPinned': { request: WidgetSetPinnedRequest, response: WidgetState },
  'widget:setCollapsed': { request: WidgetSetCollapsedRequest, response: WidgetState },
  'autostart:get': { request: Empty, response: AutostartState },
  'autostart:set': { request: AutostartSetRequest, response: AutostartState },
  'reminder:createFromSuggestion': { request: ReminderCreateFromSuggestionRequest, response: ReminderCreateFromSuggestionResponse },
  'reminder:updateFromSource': { request: ReminderUpdateFromSourceRequest, response: ReminderDto },
  'suggestion:dismiss': { request: SuggestionDismissRequest, response: SuggestionDismissResponse },
  'suggestion:listDismissed': { request: SuggestionListDismissedRequest, response: SuggestionListDismissedResponse },
  'refs:list': { request: RefsListRequest, response: RefsListResponse },
  'notes:pick': { request: NotesPickRequest, response: NotesPickResponse },
  'search:query': { request: SearchQueryRequest, response: SearchQueryResponse },
  'tags:list': { request: TagsListRequest, response: TagsListResponse },
  'tags:set': { request: TagsSetRequest, response: TagsSetResponse },
  'attachment:open': { request: AttachmentHandoffRequest, response: AttachmentOpenResponse },
  'attachment:showInFolder': { request: AttachmentHandoffRequest, response: AttachmentShowResponse },
} as const satisfies Record<InvokeChannel, ChannelSchema>;

export const EVENT_SCHEMAS = {
  'settings:changed': SettingsChangedEvent,
  'tree:changed': TreeChangedEvent,
  'note:revision': NoteRevisionEvent,
  'note:lease': NoteLeaseEvent,
  'lease:release-request': LeaseReleaseRequestEvent,
  'app:flush-request': AppFlushRequestEvent,
  'sticky:state': StickyState,
  'app:openNote': AppOpenNoteEvent,
  'reminder:changed': ReminderChangedEvent,
  'reminder:alert': ReminderAlertEvent,
  'widget:state': WidgetState,
  'app:openReminders': AppOpenRemindersEvent,
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
