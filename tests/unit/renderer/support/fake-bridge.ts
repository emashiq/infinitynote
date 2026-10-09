import type { CapabilitiesType } from '../../../../src/shared/contracts/app';
import type { AttachmentDtoType, AttachmentImportDialogResponseType } from '../../../../src/shared/contracts/attachments';
import type { InfinityBridge } from '../../../../src/shared/contracts/bridge';
import { EVENT_CHANNELS, type EventChannel } from '../../../../src/shared/contracts/channel-names';
import type { ChannelResponse } from '../../../../src/shared/contracts/channels';
import { fail, ok, type ErrorCode, type Result } from '../../../../src/shared/contracts/envelope';
import type {
  FolderDtoType,
  NoteDtoType,
  NoteSummaryType,
  ProjectDtoType,
  TrashItemType,
} from '../../../../src/shared/contracts/hierarchy';
import type { HomeScopeType } from '../../../../src/shared/contracts/home';
import { DEFAULT_SESSION, type TabSessionType } from '../../../../src/shared/contracts/session';
import { SETTINGS, type SettingKey } from '../../../../src/shared/contracts/settings';
import type { ContentOpBaseType, DraftsResolveResponseType, NoteContentResponseType } from '../../../../src/shared/contracts/notes';
import type {
  OccurrenceItemType,
  ReminderCreateRequestType,
  ReminderDtoType,
  ReminderViewType,
  RemindersSummaryResponseType,
  ZonesListResponseType,
} from '../../../../src/shared/contracts/reminders';
import type { StickyStateType } from '../../../../src/shared/contracts/stickies';
import type { AutostartStateType, WidgetStateType } from '../../../../src/shared/contracts/widget';
import { resolveLocal } from '../../../../src/shared/time/resolve';
import type { WindowGetStateResponseType } from '../../../../src/shared/contracts/windows';
import { extractPlainText } from '../../../../src/shared/text/plain-text';
import { textToDoc } from '../../../../src/shared/text/textarea-doc';
import { buildPathIndex, pathOf } from '../../../../src/shared/tree/paths';

export interface FakeDraft {
  id: string;
  noteId: string;
  content: unknown;
  format: 'rich' | 'plain';
  baseRevision: number;
  reason: 'conflict' | 'lease_lost';
  createdAt: number;
  resolved: boolean;
}

export interface FakeVersion {
  id: string;
  noteId: string;
  format: 'rich' | 'plain';
  content: unknown;
  reason: 'conversion' | 'conflict' | 'restore';
  createdAt: number;
}

export interface FakeNote extends NoteDtoType {
  content: unknown;
  format: 'rich' | 'plain';
  deletedAt: number | null;
  batch: string | null;
}

export interface FakeBridgeOptions {
  /** Emit tree:changed after each mutation, like the real main process. Default true. */
  autoEvents?: boolean;
  info?: Partial<{ version: string }>;
}

let counter = 0;
const uid = (): string => {
  counter += 1;
  const hex = counter.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
};

/** In-memory InfinityBridge for renderer-state tests. It holds no main-process logic beyond simple CRUD. */
export function createFakeBridge(options: FakeBridgeOptions = {}) {
  const autoEvents = options.autoEvents ?? true;
  const settings = new Map<string, unknown>();
  let session: TabSessionType = DEFAULT_SESSION;
  let dropped = { trashed: 0, missing: 0, duplicates: 0 };
  const projects: Array<ProjectDtoType & { deletedAt: number | null; batch: string | null }> = [];
  const folders: Array<FolderDtoType & { deletedAt: number | null; batch: string | null }> = [];
  const notes: FakeNote[] = [];
  const leases = new Map<string, string>();
  /** Notes whose lease another window holds: acquire is refused until a take (or a test) frees them. */
  const heldElsewhere = new Set<string>();
  const drafts: FakeDraft[] = [];
  const versions: FakeVersion[] = [];
  const imports: Array<{ kind: string; originalName?: string; size: number }> = [];
  /** Each importFromDialog call takes the next entry; an empty queue means canceled. */
  const dialogResults: AttachmentImportDialogResponseType[] = [];
  const shellCalls: string[] = [];
  const subscribers = new Map<string, Set<(payload: unknown) => void>>();
  const failures = new Map<string, Array<{ code: ErrorCode; message: string; details?: unknown }>>();
  const calls: Array<{ channel: string; req: unknown }> = [];
  /** Notes whose sticky window is open, with its collapse and pin state. */
  const floating = new Map<string, { collapsed: boolean; alwaysOnTop: boolean; activation: number }>();
  let windowState: WindowGetStateResponseType = { role: 'main', openNotes: [], openReminders: null, widget: { open: false, collapsed: false, alwaysOnTop: false } };
  /** Reminder state the tests arrange: the zone list, the view lists, the Home summary and each note's reminders. */
  const reminderData = {
    zones: { zones: ['America/Chicago', 'America/New_York', 'Asia/Dhaka', 'UTC'], systemZone: 'Asia/Dhaka', defaultZone: 'Asia/Dhaka', asOf: Date.parse('2026-10-08T07:00:00Z') } as ZonesListResponseType,
    views: { today: [], upcoming: [], overdue: [], completed: [] } as Record<ReminderViewType, OccurrenceItemType[]>,
    summary: null as RemindersSummaryResponseType | null,
    byNote: new Map<string, ReminderDtoType[]>(),
    deleted: new Map<string, ReminderDtoType>(),
  };
  /** The widget window and launch-at-login state main would report. */
  const windowData = {
    widget: { open: false, collapsed: false, alwaysOnTop: false } as WidgetStateType,
    autostart: { enabled: false, capability: { status: 'unsupported', reason: 'development-build' } } as AutostartStateType,
  };
  let capabilities: CapabilitiesType | null = null;
  let clock = 1_000;

  const emit = (channel: EventChannel, payload: unknown) => {
    for (const cb of subscribers.get(channel) ?? []) cb(payload);
  };
  const treeChanged = (reason: string, trashedNoteIds: string[] = []) => {
    if (autoEvents) emit('tree:changed', { reason, trashedNoteIds });
  };

  function handle<T>(channel: string, req: unknown, fn: () => Result<T>): Promise<Result<T>> {
    calls.push({ channel, req });
    const queued = failures.get(channel);
    const f = queued?.shift();
    if (f) return Promise.resolve(fail(f.code, f.message, f.details));
    return Promise.resolve(fn());
  }

  const pathIndex = () =>
    buildPathIndex(
      projects.filter((p) => p.deletedAt === null),
      folders.filter((f) => f.deletedAt === null),
    );
  const summary = (n: FakeNote): NoteSummaryType => {
    const { content: _c, format: _f, deletedAt: _d, batch: _b, ...dto } = n;
    return { ...dto, path: pathOf(pathIndex(), { projectId: n.projectId, folderId: n.folderId }) };
  };
  const dto = (n: FakeNote): NoteDtoType => {
    const { content: _c, format: _f, deletedAt: _d, batch: _b, ...rest } = n;
    return rest;
  };
  const liveNotes = () => notes.filter((n) => n.deletedAt === null);
  const stickyState = (n: FakeNote): StickyStateType => {
    const w = floating.get(n.id) ?? { collapsed: false, alwaysOnTop: false, activation: 0 };
    return {
      noteId: n.id,
      title: n.title,
      color: n.color ?? 'yellow',
      path: pathOf(pathIndex(), { projectId: n.projectId, folderId: n.folderId }),
      trashed: n.deletedAt === null ? null : { batchId: n.batch },
      ...w,
    };
  };
  const stickyNote = (noteId: string): FakeNote | Result<never> => notes.find((x) => x.id === noteId) ?? fail('NOT_FOUND', 'This note no longer exists');

  const trashNoteIds = (ids: string[], batch: string) => {
    for (const n of notes) if (ids.includes(n.id) && n.deletedAt === null) Object.assign(n, { deletedAt: clock, batch });
  };

  /** Lease and revision checks shared by conversion and restores; applies the change and bumps the revision. */
  const contentOp = (
    req: ContentOpBaseType,
    change: (n: FakeNote) => { format: 'rich' | 'plain'; content: unknown; versionId: string | null } | Result<never>,
  ): Result<NoteContentResponseType> => {
    const n = notes.find((x) => x.id === req.noteId && x.deletedAt === null);
    if (!n) return fail('NOT_FOUND', 'That item no longer exists.');
    if (leases.get(n.id) !== req.leaseToken) return fail('LEASE_REQUIRED', 'Edit control was lost');
    if (n.revision !== req.baseRevision) return fail('CONFLICT', 'This note changed elsewhere', { currentRevision: n.revision, reason: 'stale' });
    const c = change(n);
    if ('ok' in c) return c;
    clock += 1;
    Object.assign(n, { format: c.format, content: c.content, revision: n.revision + 1, updatedAt: clock });
    return ok({ noteId: n.id, revision: n.revision, format: c.format, content: c.content as never, versionId: c.versionId, updatedAt: clock });
  };
  const snapshot = (n: FakeNote, reason: FakeVersion['reason']): string => {
    const id = uid();
    versions.push({ id, noteId: n.id, format: n.format, content: n.content, reason, createdAt: clock });
    return id;
  };

  const allReminders = () => [...reminderData.byNote.values()].flat();
  const viewItems = () => Object.values(reminderData.views).flat();
  /** A reminder as main would answer it; the instant comes from the shared resolver. */
  const toReminder = (req: ReminderCreateRequestType, id: string, revision: number): ReminderDtoType => {
    const r = resolveLocal({ date: req.date, time: req.time }, req.zoneId, req.foldPreference);
    return {
      id,
      noteId: req.noteId,
      blockId: req.blockId,
      anchorState: 'ok',
      title: req.title,
      zoneId: req.zoneId,
      date: req.date,
      time: req.time,
      recurrence: req.recurrence,
      foldPreference: req.foldPreference,
      followup: req.followup,
      revision,
      createdAt: clock,
      updatedAt: clock,
      resolution: { status: r.status },
      current: null,
    };
  };

  const bridge: InfinityBridge = {
    app: {
      getInfo: () =>
        handle('app:getInfo', {}, () =>
          ok({
            name: 'Infinity Notes',
            version: options.info?.version ?? '0.1.0',
            isPackaged: false,
            unsignedBuild: true as const,
            platform: 'win32',
            arch: 'x64',
            versions: { electron: '0', chrome: '0', node: '0' },
            sqlite: { driver: 'fake', version: '3.0.0', fts5: true, json: true },
            schemaVersion: 4,
            startup: { status: 'ok' as const },
          }),
        ),
      showDataFolder: () => handle('app:showDataFolder', {}, () => ok({ opened: true as const })),
      quit: () => handle('app:quit', {}, () => ok({})),
      flushed: (req) => handle('app:flushed', req, () => ok({})),
    },
    attachment: {
      importBytes: (req) =>
        handle('attachment:importBytes', req, () => {
          imports.push({ kind: req.kind, originalName: req.originalName, size: req.bytes.byteLength });
          const dto: AttachmentDtoType = {
            id: uid(),
            kind: req.kind,
            mime: req.kind === 'image' ? 'image/png' : 'application/octet-stream',
            sizeBytes: req.bytes.byteLength,
            originalName: req.originalName ?? null,
            width: req.kind === 'image' ? 4 : null,
            height: req.kind === 'image' ? 3 : null,
          };
          return ok({ attachment: dto });
        }),
      importFromDialog: (req) => handle('attachment:importFromDialog', req, () => ok(dialogResults.shift() ?? { canceled: true, imported: [], rejected: [] })),
    },
    shell: {
      openExternal: (req) =>
        handle('shell:openExternal', req, () => {
          shellCalls.push(req.url);
          return ok({ opened: true as const });
        }),
    },
    versions: {
      list: (req) =>
        handle('versions:list', req, () =>
          ok({
            versions: versions
              .filter((v) => v.noteId === req.noteId)
              .reverse()
              .map((v) => ({ id: v.id, revision: 0, format: v.format, reason: v.reason, createdAt: v.createdAt, preview: extractPlainText(v.format, v.content).slice(0, 200), attachmentCount: 0 })),
          }),
        ),
      restore: (req) =>
        handle('versions:restore', req, () =>
          contentOp(req, (n) => {
            const v = versions.find((x) => x.id === req.versionId && x.noteId === n.id);
            if (!v) return fail('NOT_FOUND', 'That version no longer exists.');
            return { format: v.format, content: v.content, versionId: snapshot(n, 'restore') };
          }),
        ),
    },
    drafts: {
      list: (req) =>
        handle('drafts:list', req, () =>
          ok({
            drafts: drafts
              .filter((d) => d.noteId === req.noteId && !d.resolved)
              .reverse()
              .map((d) => {
                const text = extractPlainText(d.format, d.content);
                return { id: d.id, reason: d.reason, baseRevision: d.baseRevision, format: d.format, title: null, createdAt: d.createdAt, plainText: text, truncated: false };
              }),
          }),
        ),
      resolve: (req) =>
        handle<DraftsResolveResponseType>('drafts:resolve', req, () => {
          const d = drafts.find((x) => x.id === req.draftId && x.noteId === req.noteId && !x.resolved);
          if (!d) return fail('NOT_FOUND', 'That recovered draft no longer exists.');
          if (req.action === 'dismiss') {
            d.resolved = true;
            return ok({ resolved: true as const, content: null });
          }
          const res = contentOp(req, (n) => ({ format: d.format, content: d.content, versionId: snapshot(n, 'conflict') }));
          if (!res.ok) return res;
          d.resolved = true;
          return ok({ resolved: true as const, content: res.data });
        }),
    },
    settings: {
      get: (req) =>
        handle('settings:get', req, () => {
          const values: Record<string, unknown> = {};
          for (const k of req.keys) values[k] = settings.has(k) ? settings.get(k) : SETTINGS[k as SettingKey].default;
          return ok({ values });
        }),
      set: (req) =>
        handle('settings:set', req, () => {
          settings.set(req.key, req.value);
          const payload = { key: req.key, value: req.value, updatedAt: clock };
          emit('settings:changed', payload);
          return ok(payload);
        }),
    },
    capabilities: { get: () => handle('capabilities:get', {}, () => (capabilities ? ok(capabilities) : fail('UNSUPPORTED', 'not faked'))) },
    tree: {
      list: () =>
        handle('tree:list', {}, () =>
          ok({
            projects: projects.filter((p) => p.deletedAt === null).map(({ deletedAt: _d, batch: _b, ...p }) => p),
            folders: folders.filter((f) => f.deletedAt === null).map(({ deletedAt: _d, batch: _b, ...f }) => f),
            notes: liveNotes().map(dto),
          }),
        ),
    },
    project: {
      create: (req) =>
        handle('project:create', req, () => {
          clock += 1;
          const p = { id: uid(), name: req.name.trim(), favorite: false, createdAt: clock, updatedAt: clock, deletedAt: null, batch: null };
          projects.push(p);
          treeChanged('create');
          const { deletedAt: _d, batch: _b, ...project } = p;
          return ok({ project });
        }),
      rename: (req) =>
        handle('project:rename', req, () => {
          const p = projects.find((x) => x.id === req.projectId && x.deletedAt === null);
          if (!p) return fail('NOT_FOUND', 'That item no longer exists.');
          p.name = req.name.trim();
          treeChanged('rename');
          const { deletedAt: _d, batch: _b, ...project } = p;
          return ok({ project });
        }),
      trash: (req) =>
        handle('project:trash', req, () => {
          const p = projects.find((x) => x.id === req.projectId && x.deletedAt === null);
          if (!p) return fail('NOT_FOUND', 'That item no longer exists.');
          const batch = uid();
          clock += 1;
          Object.assign(p, { deletedAt: clock, batch });
          const f = folders.filter((x) => x.projectId === p.id && x.deletedAt === null);
          f.forEach((x) => Object.assign(x, { deletedAt: clock, batch }));
          const ids = liveNotes().filter((n) => n.projectId === p.id).map((n) => n.id);
          trashNoteIds(ids, batch);
          treeChanged('trash', ids);
          return ok({ trashBatchId: batch, counts: { projects: 1, folders: f.length, notes: ids.length }, trashedNoteIds: ids });
        }),
    },
    folder: {
      create: (req) =>
        handle('folder:create', req, () => {
          clock += 1;
          const f = { id: uid(), projectId: req.location.projectId, parentId: req.location.parentId, name: req.name.trim(), favorite: false, createdAt: clock, updatedAt: clock, deletedAt: null, batch: null };
          folders.push(f);
          treeChanged('create');
          const { deletedAt: _d, batch: _b, ...folder } = f;
          return ok({ folder });
        }),
      rename: (req) =>
        handle('folder:rename', req, () => {
          const f = folders.find((x) => x.id === req.folderId && x.deletedAt === null);
          if (!f) return fail('NOT_FOUND', 'That item no longer exists.');
          f.name = req.name.trim();
          treeChanged('rename');
          const { deletedAt: _d, batch: _b, ...folder } = f;
          return ok({ folder });
        }),
      move: (req) =>
        handle('folder:move', req, () => {
          const f = folders.find((x) => x.id === req.folderId && x.deletedAt === null);
          if (!f) return fail('NOT_FOUND', 'That item no longer exists.');
          f.projectId = req.target.projectId;
          f.parentId = req.target.parentId;
          treeChanged('move');
          const { deletedAt: _d, batch: _b, ...folder } = f;
          return ok({ folder, movedFolders: 1, movedNotes: 0 });
        }),
      trash: (req) =>
        handle('folder:trash', req, () => {
          const f = folders.find((x) => x.id === req.folderId && x.deletedAt === null);
          if (!f) return fail('NOT_FOUND', 'That item no longer exists.');
          const batch = uid();
          clock += 1;
          const ids: string[] = [];
          const walk = (id: string) => {
            const node = folders.find((x) => x.id === id)!;
            Object.assign(node, { deletedAt: clock, batch });
            for (const n of liveNotes().filter((x) => x.folderId === id)) ids.push(n.id);
            for (const child of folders.filter((x) => x.parentId === id && x.deletedAt === null)) walk(child.id);
          };
          walk(f.id);
          trashNoteIds(ids, batch);
          treeChanged('trash', ids);
          return ok({ trashBatchId: batch, counts: { projects: 0, folders: 1, notes: ids.length }, trashedNoteIds: ids });
        }),
    },
    note: {
      create: (req) =>
        handle('note:create', req, () => {
          clock += 1;
          const n: FakeNote = {
            id: uid(),
            projectId: req.location.projectId,
            folderId: req.location.folderId,
            title: req.title ?? '',
            sticky: req.sticky,
            color: req.sticky ? 'yellow' : null,
            pinnedAt: null,
            favorite: false,
            revision: 0,
            createdAt: clock,
            updatedAt: clock,
            content: req.format === 'plain' ? '' : { type: 'doc', content: [{ type: 'paragraph' }] },
            format: req.format ?? 'rich',
            deletedAt: null,
            batch: null,
          };
          notes.push(n);
          treeChanged('create');
          return ok({ note: dto(n) });
        }),
      rename: (req) =>
        handle('note:rename', req, () => {
          const n = liveNotes().find((x) => x.id === req.noteId);
          if (!n) return fail('NOT_FOUND', 'That item no longer exists.');
          n.title = req.title;
          clock += 1;
          n.updatedAt = clock;
          treeChanged('rename');
          return ok({ note: dto(n) });
        }),
      move: (req) =>
        handle('note:move', req, () => {
          const n = liveNotes().find((x) => x.id === req.noteId);
          if (!n) return fail('NOT_FOUND', 'That item no longer exists.');
          n.projectId = req.target.projectId;
          n.folderId = req.target.folderId;
          treeChanged('move');
          return ok({ note: dto(n) });
        }),
      trash: (req) =>
        handle('note:trash', req, () => {
          const n = liveNotes().find((x) => x.id === req.noteId);
          if (!n) return fail('NOT_FOUND', 'That item no longer exists.');
          const batch = uid();
          clock += 1;
          trashNoteIds([n.id], batch);
          treeChanged('trash', [n.id]);
          return ok({ trashBatchId: batch, counts: { projects: 0, folders: 0, notes: 1 }, trashedNoteIds: [n.id] });
        }),
      setPinned: (req) =>
        handle('note:setPinned', req, () => {
          const n = liveNotes().find((x) => x.id === req.noteId);
          if (!n) return fail('NOT_FOUND', 'That item no longer exists.');
          n.pinnedAt = req.pinned ? (n.pinnedAt ?? clock) : null;
          treeChanged('pin');
          return ok({ note: dto(n) });
        }),
      open: (req) =>
        handle('note:open', req, () => {
          const n = notes.find((x) => x.id === req.noteId);
          if (!n) return fail('NOT_FOUND', 'That item no longer exists.');
          if (n.deletedAt !== null) return fail('NOT_FOUND', 'This note is in Trash', { trashed: true, trashBatchId: n.batch });
          return ok({ note: summary(n), format: n.format, content: n.content as never, revision: n.revision });
        }),
      save: (req) =>
        handle('note:save', req, () => {
          const n = notes.find((x) => x.id === req.noteId);
          if (!n) return fail('NOT_FOUND', 'Note not found');
          if (leases.get(n.id) !== req.leaseToken) {
            const draftId = uid();
            drafts.push({ id: draftId, noteId: n.id, content: req.content, format: req.format, baseRevision: req.baseRevision, reason: 'lease_lost', createdAt: clock, resolved: false });
            return fail('LEASE_REQUIRED', 'Edit control was lost', { draftId });
          }
          if (n.deletedAt !== null || n.revision !== req.baseRevision) {
            const draftId = uid();
            drafts.push({ id: draftId, noteId: n.id, content: req.content, format: req.format, baseRevision: req.baseRevision, reason: 'conflict', createdAt: clock, resolved: false });
            const reason = n.deletedAt !== null ? 'trashed' : 'stale';
            return fail('CONFLICT', 'This note changed elsewhere', { currentRevision: n.revision, draftId, reason });
          }
          n.content = req.content;
          n.revision += 1;
          clock += 1;
          n.updatedAt = clock;
          return ok({ noteId: n.id, revision: n.revision, requestId: req.requestId, updatedAt: clock });
        }),
      convertFormat: (req) =>
        handle('note:convertFormat', req, () =>
          contentOp(req, (n) => {
            if (n.format === req.targetFormat) return fail('VALIDATION_FAILED', 'Same format');
            const versionId = snapshot(n, 'conversion');
            const content = req.targetFormat === 'plain' ? extractPlainText('rich', n.content) : textToDoc(String(n.content), { id: uid });
            return { format: req.targetFormat, content, versionId };
          }),
        ),
    },
    item: {
      setFavorite: (req) =>
        handle('item:setFavorite', req, () => {
          const row =
            req.kind === 'project' ? projects.find((x) => x.id === req.id) : req.kind === 'folder' ? folders.find((x) => x.id === req.id) : notes.find((x) => x.id === req.id);
          if (!row) return fail('NOT_FOUND', 'That item no longer exists.');
          row.favorite = req.favorite;
          treeChanged('favorite');
          return ok({ kind: req.kind, id: req.id, favorite: req.favorite });
        }),
    },
    lease: {
      acquire: (req) =>
        handle<ChannelResponse<'lease:acquire'>>('lease:acquire', req, () => {
          if (heldElsewhere.has(req.noteId)) return ok({ granted: false as const, holderViewId: '99999999-9999-4999-8999-999999999999' });
          const token = `lease-${req.noteId}-${req.viewId}`;
          leases.set(req.noteId, token);
          return ok({ granted: true as const, leaseToken: token });
        }),
      release: (req) =>
        handle('lease:release', req, () => {
          const held = leases.get(req.noteId) === req.leaseToken;
          if (held) leases.delete(req.noteId);
          return ok({ released: held });
        }),
      take: (req) =>
        handle('lease:take', req, () => {
          heldElsewhere.delete(req.noteId);
          const token = 'take-' + req.noteId + '-' + uid();
          leases.set(req.noteId, token);
          return ok({ leaseToken: token });
        }),
    },
    trash: {
      list: () =>
        handle('trash:list', {}, () => {
          const items: TrashItemType[] = [];
          for (const p of projects.filter((x) => x.deletedAt !== null)) {
            items.push({ batchId: p.batch!, kind: 'project', id: p.id, label: p.name, sticky: false, deletedAt: p.deletedAt!, fromPath: [], contains: { folders: 0, notes: 0 } });
          }
          const batchesWithProject = new Set(projects.map((p) => p.batch));
          const seen = new Set<string>();
          for (const f of folders.filter((x) => x.deletedAt !== null && !batchesWithProject.has(x.batch))) {
            if (seen.has(f.batch!)) continue;
            const root = folders.filter((x) => x.batch === f.batch).find((x) => x.parentId === null || folders.find((y) => y.id === x.parentId)?.batch !== f.batch)!;
            seen.add(f.batch!);
            items.push({ batchId: f.batch!, kind: 'folder', id: root.id, label: root.name, sticky: false, deletedAt: root.deletedAt!, fromPath: [], contains: { folders: 0, notes: 0 } });
          }
          const batchesWithFolder = new Set(folders.map((f) => f.batch));
          for (const n of notes.filter((x) => x.deletedAt !== null && !batchesWithFolder.has(x.batch) && !batchesWithProject.has(x.batch))) {
            items.push({ batchId: n.batch!, kind: 'note', id: n.id, label: n.title, sticky: n.sticky, deletedAt: n.deletedAt!, fromPath: [], contains: { folders: 0, notes: 0 } });
          }
          return ok({ items });
        }),
      restore: (req) =>
        handle('trash:restore', req, () => {
          const touched = [...projects, ...folders, ...notes].filter((x) => x.batch === req.batchId);
          if (touched.length === 0) return fail('NOT_FOUND', 'That item is no longer in Trash.');
          const restoredNoteIds = notes.filter((n) => n.batch === req.batchId).map((n) => n.id);
          for (const x of touched) Object.assign(x, { deletedAt: null, batch: null });
          const root = touched[0]!;
          const kind = projects.includes(root as never) ? 'project' : folders.includes(root as never) ? 'folder' : 'note';
          treeChanged('restore');
          return ok({ kind, id: root.id, relocated: false, location: { projectId: null, folderId: null }, path: ['Common'], restoredNoteIds });
        }),
      purge: (req) =>
        handle('trash:purge', req, () => {
          const batch = req.target.kind === 'batch' ? req.target.batchId : null;
          const hit = (x: { batch: string | null; deletedAt: number | null }) => x.deletedAt !== null && (batch === null || x.batch === batch);
          const count = (arr: Array<{ batch: string | null; deletedAt: number | null }>) => {
            let n = 0;
            for (let i = arr.length - 1; i >= 0; i -= 1) {
              if (hit(arr[i]!)) {
                arr.splice(i, 1);
                n += 1;
              }
            }
            return n;
          };
          const purged = { projects: count(projects), folders: count(folders), notes: count(notes) };
          treeChanged('purge');
          return ok({ purged });
        }),
    },
    home: {
      summary: (req) =>
        handle('home:summary', req, () => {
          let scope: HomeScopeType = req.scope;
          let scopeValid = true;
          if (scope.kind === 'project') {
            const id = scope.projectId;
            if (!projects.some((p) => p.id === id && p.deletedAt === null)) {
              scope = { kind: 'all' };
              scopeValid = false;
            }
          }
          const inScope = (n: FakeNote) => scope.kind === 'all' || (scope.kind === 'common' ? n.projectId === null : n.projectId === (scope as { projectId: string }).projectId);
          const pool = liveNotes().filter(inScope);
          const pinned = pool.filter((n) => n.pinnedAt !== null).sort((a, b) => b.pinnedAt! - a.pinnedAt!);
          const recent = [...pool].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
          return ok({ scope, scopeValid, pinned: pinned.map(summary), pinnedTotal: pinned.length, recent: recent.map(summary) });
        }),
    },
    session: {
      get: () => handle('session:get', {}, () => ok({ session, dropped })),
      set: (req) =>
        handle('session:set', req, () => {
          session = req.session;
          return ok({ savedAt: clock });
        }),
    },
    palette: {
      searchTitles: (req) =>
        handle('palette:searchTitles', req, () => {
          const q = req.query.trim().toLowerCase();
          if (!q) return ok({ results: [] });
          return ok({ results: liveNotes().filter((n) => (n.title || 'Untitled').toLowerCase().includes(q)).map(summary) });
        }),
    },
    sticky: {
      float: (req) =>
        handle('sticky:float', req, () => {
          const n = notes.find((x) => x.id === req.noteId);
          if (!n) return fail('NOT_FOUND', 'This note no longer exists');
          if (n.deletedAt !== null) return fail('NOT_FOUND', 'This note is in Trash', { trashed: true, trashBatchId: n.batch });
          const changed = !n.sticky || n.color === null;
          Object.assign(n, { sticky: true, color: n.color ?? 'yellow' });
          if (changed) treeChanged('sticky');
          const w = floating.get(n.id);
          if (w) w.activation += 1;
          else floating.set(n.id, { collapsed: false, alwaysOnTop: false, activation: 1 });
          return ok({ noteId: n.id, created: !w });
        }),
      dock: (req) => handle('sticky:dock', req, () => (floating.delete(req.noteId), ok({}))),
      hide: (req) => handle('sticky:hide', req, () => (floating.delete(req.noteId), ok({}))),
      remove: (req) =>
        handle('sticky:remove', req, () => {
          const n = stickyNote(req.noteId);
          if ('ok' in n) return n;
          floating.delete(n.id);
          n.sticky = false;
          treeChanged('sticky');
          return ok({});
        }),
      setColor: (req) =>
        handle('sticky:setColor', req, () => {
          const n = stickyNote(req.noteId);
          if ('ok' in n) return n;
          if (!n.sticky) return fail('VALIDATION_FAILED', 'This note is not a sticky');
          n.color = req.color;
          treeChanged('sticky');
          return ok(floating.has(n.id) ? stickyState(n) : null);
        }),
      setPinned: (req) =>
        handle('sticky:setPinned', req, () => {
          const n = stickyNote(req.noteId);
          if ('ok' in n) return n;
          const w = floating.get(n.id);
          if (w) w.alwaysOnTop = req.pinned;
          return ok(stickyState(n));
        }),
      setCollapsed: (req) =>
        handle('sticky:setCollapsed', req, () => {
          const n = stickyNote(req.noteId);
          if ('ok' in n) return n;
          const w = floating.get(n.id);
          if (w) w.collapsed = req.collapsed;
          return ok(stickyState(n));
        }),
      restore: (req) =>
        handle('sticky:restore', req, () => {
          const n = stickyNote(req.noteId);
          if ('ok' in n) return n;
          if (n.deletedAt === null) return fail('VALIDATION_FAILED', 'This note is not in Trash');
          Object.assign(n, { deletedAt: null, batch: null });
          treeChanged('restore');
          return ok({ kind: 'note' as const, id: n.id, relocated: false, location: { projectId: null, folderId: null }, path: ['Common'], restoredNoteIds: [n.id] });
        }),
    },
    window: {
      getState: () => handle('window:getState', {}, () => ok(windowState)),
    },
    zones: { list: () => handle('zones:list', {}, () => ok(reminderData.zones)) },
    reminder: {
      create: (req) =>
        handle('reminder:create', req, () => {
          const full = { foldPreference: 'earlier' as const, allowPast: false, ...req };
          const dto = toReminder(full, uid(), 1);
          reminderData.byNote.set(req.noteId, [...(reminderData.byNote.get(req.noteId) ?? []), dto]);
          return ok(dto);
        }),
      update: (req) =>
        handle('reminder:update', req, () => {
          const old = allReminders().find((r) => r.id === req.reminderId);
          if (!old) return fail('NOT_FOUND', 'This reminder no longer exists');
          if (old.revision !== req.expectedRevision) return fail('CONFLICT', 'This reminder changed elsewhere. Reopen it to edit.', { currentRevision: old.revision });
          const dto = toReminder({ foldPreference: 'earlier', allowPast: false, ...req, noteId: old.noteId }, old.id, old.revision + 1);
          reminderData.byNote.set(old.noteId, reminderData.byNote.get(old.noteId)!.map((r) => (r.id === old.id ? dto : r)));
          return ok(dto);
        }),
      delete: (req) =>
        handle('reminder:delete', req, () => {
          const old = allReminders().find((r) => r.id === req.reminderId);
          if (!old) return fail('NOT_FOUND', 'This reminder no longer exists');
          reminderData.byNote.set(old.noteId, reminderData.byNote.get(old.noteId)!.filter((r) => r.id !== old.id));
          reminderData.deleted.set(old.id, old);
          return ok({ reminderId: old.id, undoUntil: clock + 10_000 });
        }),
      undoDelete: (req) =>
        handle('reminder:undoDelete', req, () => {
          const old = reminderData.deleted.get(req.reminderId);
          if (!old) return fail('VALIDATION_FAILED', 'Undo is no longer available');
          reminderData.deleted.delete(old.id);
          reminderData.byNote.set(old.noteId, [...(reminderData.byNote.get(old.noteId) ?? []), old]);
          return ok(old);
        }),
      listForNote: (req) =>
        handle('reminder:listForNote', req, () => ok({ reminders: reminderData.byNote.get(req.noteId) ?? [], asOf: clock, displayZone: reminderData.zones.systemZone })),
      open: (req) => handle('reminder:open', req, () => ok({})),
    },
    reminders: {
      listView: (req) =>
        handle('reminders:listView', req, () => {
          const { views } = reminderData;
          return ok({
            view: req.view,
            asOf: clock,
            displayZone: reminderData.zones.systemZone,
            items: views[req.view],
            counts: { today: views.today.length, upcoming: views.upcoming.length, overdue: views.overdue.length },
          });
        }),
      summary: (req) =>
        handle('reminders:summary', req, () => {
          const { views } = reminderData;
          return ok(
            reminderData.summary ?? {
              asOf: clock,
              displayZone: reminderData.zones.systemZone,
              overdue: views.overdue.slice(0, 5),
              overdueTotal: views.overdue.length,
              today: views.today.slice(0, 5),
              todayTotal: views.today.length,
            },
          );
        }),
    },
    occurrence: {
      complete: (req) =>
        handle('occurrence:complete', req, () => {
          const item = viewItems().find((i) => i.occurrenceId === req.occurrenceId);
          return item ? ok({ ...item, state: 'completed' as const, completedAt: clock, overdue: false }) : fail('NOT_FOUND', 'This reminder no longer exists');
        }),
      snooze: (req) =>
        handle('occurrence:snooze', req, () => {
          const item = viewItems().find((i) => i.occurrenceId === req.occurrenceId);
          return item ? ok({ ...item, state: 'snoozed' as const, overdue: false }) : fail('NOT_FOUND', 'This reminder no longer exists');
        }),
    },
    widget: {
      show: () => handle('widget:show', {}, () => ok((windowData.widget = { ...windowData.widget, open: true }))),
      hide: () => handle('widget:hide', {}, () => ok((windowData.widget = { ...windowData.widget, open: false }))),
      setPinned: (req) =>
        handle('widget:setPinned', req, () =>
          capabilities?.alwaysOnTop.status === 'unsupported'
            ? fail('UNSUPPORTED', 'Not supported by this desktop')
            : ok((windowData.widget = { ...windowData.widget, alwaysOnTop: req.pinned })),
        ),
      setCollapsed: (req) => handle('widget:setCollapsed', req, () => ok((windowData.widget = { ...windowData.widget, collapsed: req.collapsed }))),
    },
    autostart: {
      get: () => handle('autostart:get', {}, () => ok(windowData.autostart)),
      set: (req) =>
        handle('autostart:set', req, () =>
          windowData.autostart.capability.status === 'supported'
            ? ok((windowData.autostart = { ...windowData.autostart, enabled: req.enabled }))
            : fail('UNSUPPORTED', 'Not supported by this desktop'),
        ),
    },
    subscribe(channel, cb) {
      if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) throw new Error('Unknown event channel');
      let set = subscribers.get(channel);
      if (!set) {
        set = new Set();
        subscribers.set(channel, set);
      }
      const listener = cb as (payload: unknown) => void;
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };

  return {
    bridge,
    calls,
    emit,
    /** Make the next call(s) on a channel fail with this error. */
    failNext(channel: string, error: { code: ErrorCode; message?: string; details?: unknown }, times = 1) {
      const list = failures.get(channel) ?? [];
      for (let i = 0; i < times; i += 1) list.push({ code: error.code, message: error.message ?? error.code, details: error.details });
      failures.set(channel, list);
    },
    callsTo: (channel: string) => calls.filter((c) => c.channel === channel),
    /** Live event subscriptions over every channel (dispose checks). */
    subscriberCount: () => [...subscribers.values()].reduce((n, set) => n + set.size, 0),
    /** The sticky window state a note would have in main. */
    stickyState: (noteId: string) => stickyState(notes.find((n) => n.id === noteId)!),
    /** Direct access for arranging state in tests. */
    data: { reminders: reminderData, windows: windowData, setDropped: (d: typeof dropped) => (dropped = d), setWindowState: (w: WindowGetStateResponseType) => (windowState = w), setCapabilities: (c: CapabilitiesType) => (capabilities = c), floating, heldElsewhere, settings, projects, folders, notes, leases, drafts, versions, imports, dialogResults, shellCalls, getSession: () => session, setSession: (s: TabSessionType) => (session = s) },
  };
}

export type FakeBridge = ReturnType<typeof createFakeBridge>;
