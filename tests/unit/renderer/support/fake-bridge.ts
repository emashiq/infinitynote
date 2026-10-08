import type { InfinityBridge } from '../../../../src/shared/contracts/bridge';
import type { EventChannel } from '../../../../src/shared/contracts/channel-names';
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
import { buildPathIndex, pathOf } from '../../../../src/shared/tree/paths';

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
  const subscribers = new Map<string, Set<(payload: unknown) => void>>();
  const failures = new Map<string, Array<{ code: ErrorCode; message: string; details?: unknown }>>();
  const calls: Array<{ channel: string; req: unknown }> = [];
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

  const trashNoteIds = (ids: string[], batch: string) => {
    for (const n of notes) if (ids.includes(n.id) && n.deletedAt === null) Object.assign(n, { deletedAt: clock, batch });
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
            schemaVersion: 3,
            startup: { status: 'ok' as const },
          }),
        ),
      showDataFolder: () => handle('app:showDataFolder', {}, () => ok({ opened: true as const })),
      quit: () => handle('app:quit', {}, () => ok({})),
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
    capabilities: { get: () => handle('capabilities:get', {}, () => fail('UNSUPPORTED', 'not faked')) },
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
            content: { type: 'doc', content: [{ type: 'paragraph' }] },
            format: 'rich',
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
          if (leases.get(n.id) !== req.leaseToken) return fail('LEASE_REQUIRED', 'Edit control was lost');
          if (n.revision !== req.baseRevision) return fail('CONFLICT', 'This note changed elsewhere');
          n.content = req.content;
          n.revision += 1;
          clock += 1;
          n.updatedAt = clock;
          return ok({ noteId: n.id, revision: n.revision, requestId: req.requestId, updatedAt: clock });
        }),
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
        handle('lease:acquire', req, () => {
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
    subscribe(channel, cb) {
      if (!['settings:changed', 'tree:changed'].includes(channel)) throw new Error('Unknown event channel');
      let set = subscribers.get(channel);
      if (!set) {
        set = new Set();
        subscribers.set(channel, set);
      }
      set.add(cb);
      return () => {
        set.delete(cb);
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
    /** Direct access for arranging state in tests. */
    data: { setDropped: (d: typeof dropped) => (dropped = d), settings, projects, folders, notes, leases, getSession: () => session, setSession: (s: TabSessionType) => (session = s) },
  };
}

export type FakeBridge = ReturnType<typeof createFakeBridge>;
