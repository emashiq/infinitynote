import type { z } from 'zod';
import type { AppInfoType, CapabilitiesType } from './app';
import type { EventChannel } from './channel-names';
import type { Result } from './envelope';
import type {
  FolderCreateRequest,
  FolderDtoType,
  FolderMoveRequest,
  FolderMoveResponseType,
  FolderRenameRequest,
  ItemSetFavoriteRequest,
  NoteCreateRequest,
  NoteDtoType,
  NoteMoveRequest,
  NoteRenameRequest,
  NoteSummaryType,
  ProjectCreateRequest,
  ProjectDtoType,
  ProjectRenameRequest,
  TrashItemType,
  TrashPurgeRequest,
  TrashRestoreResponseType,
  TrashResultType,
  TreeSnapshotType,
  ItemKindType,
} from './hierarchy';
import type { HomeScopeType, HomeSummaryType } from './home';
import type {
  LeaseAcquireRequest,
  LeaseAcquireResponse,
  LeaseReleaseRequest,
  LeaseReleaseResponse,
  NoteOpenResponseType,
  NoteSaveAckType,
  NoteSaveRequestType,
} from './notes';
import type { SessionGetResponseType, TabSessionType } from './session';
import type { PublicSettingKey, SettingValue, SettingsChangedPayload } from './settings';

type In<T extends z.ZodType> = z.input<T>;
type Res<T> = Promise<Result<T>>;

export type SettingsSetArgs = {
  [K in PublicSettingKey]: { key: K; value: SettingValue<K> };
}[PublicSettingKey];

export interface InfinityBridge {
  readonly app: {
    getInfo(): Res<AppInfoType>;
    showDataFolder(): Res<{ opened: true }>;
    quit(): Res<Record<string, never>>;
  };
  readonly settings: {
    get(req: { keys: PublicSettingKey[] }): Res<{ values: Partial<{ [K in PublicSettingKey]: SettingValue<K> }> }>;
    set(req: SettingsSetArgs): Res<SettingsChangedPayload>;
  };
  readonly capabilities: {
    get(): Res<CapabilitiesType>;
  };
  readonly tree: {
    list(): Res<TreeSnapshotType>;
  };
  readonly project: {
    create(req: In<typeof ProjectCreateRequest>): Res<{ project: ProjectDtoType }>;
    rename(req: In<typeof ProjectRenameRequest>): Res<{ project: ProjectDtoType }>;
    trash(req: { projectId: string }): Res<TrashResultType>;
  };
  readonly folder: {
    create(req: In<typeof FolderCreateRequest>): Res<{ folder: FolderDtoType }>;
    rename(req: In<typeof FolderRenameRequest>): Res<{ folder: FolderDtoType }>;
    move(req: In<typeof FolderMoveRequest>): Res<FolderMoveResponseType>;
    trash(req: { folderId: string }): Res<TrashResultType>;
  };
  readonly note: {
    create(req: In<typeof NoteCreateRequest>): Res<{ note: NoteDtoType }>;
    rename(req: In<typeof NoteRenameRequest>): Res<{ note: NoteDtoType }>;
    move(req: In<typeof NoteMoveRequest>): Res<{ note: NoteDtoType }>;
    trash(req: { noteId: string }): Res<TrashResultType>;
    setPinned(req: { noteId: string; pinned: boolean }): Res<{ note: NoteDtoType }>;
    open(req: { noteId: string }): Res<NoteOpenResponseType>;
    save(req: NoteSaveRequestType): Res<NoteSaveAckType>;
  };
  readonly item: {
    setFavorite(req: In<typeof ItemSetFavoriteRequest>): Res<{ kind: ItemKindType; id: string; favorite: boolean }>;
  };
  readonly lease: {
    acquire(req: In<typeof LeaseAcquireRequest>): Res<z.infer<typeof LeaseAcquireResponse>>;
    release(req: In<typeof LeaseReleaseRequest>): Res<z.infer<typeof LeaseReleaseResponse>>;
  };
  readonly trash: {
    list(): Res<{ items: TrashItemType[] }>;
    restore(req: { batchId: string }): Res<TrashRestoreResponseType>;
    purge(req: In<typeof TrashPurgeRequest>): Res<{ purged: { projects: number; folders: number; notes: number } }>;
  };
  readonly home: {
    summary(req: { scope: HomeScopeType }): Res<HomeSummaryType>;
  };
  readonly session: {
    get(): Res<SessionGetResponseType>;
    set(req: { session: TabSessionType }): Res<{ savedAt: number }>;
  };
  readonly palette: {
    searchTitles(req: { query: string; limit?: number }): Res<{ results: NoteSummaryType[] }>;
  };
  subscribe(channel: EventChannel, cb: (payload: unknown) => void): () => void;
}
