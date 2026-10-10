import type { HexColor } from '../../../../src/shared/color';
import type { BackupStatusType } from '../../../../src/shared/contracts/portability';
import type { ShortcutStateType } from '../../../../src/shared/contracts/shortcuts';
import type { CapabilitiesType } from '../../../../src/shared/contracts/app';
import type { AttachmentDtoType } from '../../../../src/shared/contracts/attachments';
import type { InfinityBridge } from '../../../../src/shared/contracts/bridge';
import { EVENT_CHANNELS, type EventChannel } from '../../../../src/shared/contracts/channel-names';
import type { ChannelResponse } from '../../../../src/shared/contracts/channels';
import { fail, ok, type ErrorCode, type Result } from '../../../../src/shared/contracts/envelope';
import { LINK_MESSAGES } from '../../../../src/shared/attachments/link-messages';
import type { DocumentFileInfoType, DocumentReadWorkbookResponseType, DocumentVersionDtoType } from '../../../../src/shared/contracts/documents';
import { DOCUMENT_KIND_INFO } from '../../../../src/shared/documents/kinds';
import { DOCUMENT_MESSAGES } from '../../../../src/shared/documents/messages';
import type { WorkbookType } from '../../../../src/shared/documents/workbook';
import type {
  DocumentDtoType,
  FolderDtoType,
  NoteDtoType,
  NoteSummaryType,
  ProjectDtoType,
  TrashItemType,
} from '../../../../src/shared/contracts/hierarchy';
import type { HomeScopeType } from '../../../../src/shared/contracts/home';
import { COMMENT_MESSAGES, type CommentThreadDtoType } from '../../../../src/shared/contracts/comments';
import { LOCK_MESSAGES, PIN_RE, PIN_STRIKES, type LockStatusType, type OsKeyAvailabilityType, type StickyLockStateType } from '../../../../src/shared/contracts/locks';
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
import type { DismissalDtoType, ReminderCreateFromSuggestionResponseType, SuggestionSourceType } from '../../../../src/shared/contracts/suggestions';
import { normalizePhrase } from '../../../../src/shared/nlp/source-text';
import type { AutostartStateType, WidgetStateType } from '../../../../src/shared/contracts/widget';
import { resolveLocal } from '../../../../src/shared/time/resolve';
import type { WindowGetStateResponseType } from '../../../../src/shared/contracts/windows';
import { extractPlainText } from '../../../../src/shared/text/plain-text';
import { BLOCK_ID_TYPES, collectDocRefs, collectNoteRefs } from '../../../../src/shared/editor/doc-schema';
import { rankByTitle } from '../../../../src/shared/search/fuzzy';
import type { NotesPickResponseType } from '../../../../src/shared/contracts/references';
import { textBlocksOf } from '../../../../src/shared/editor/text-blocks';
import { docToText, textToDoc } from '../../../../src/shared/text/textarea-doc';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Step } from '@tiptap/pm/transform';
import { noteSchema } from '../../../../src/shared/editor/schema';
import { toSavable } from '../../../../src/shared/editor/savable';
import { buildPathIndex, pathOf } from '../../../../src/shared/tree/paths';

export interface FakeDraft {
  id: string;
  noteId: string;
  content: unknown;
  format: 'rich' | 'plain';
  baseRevision: number;
  reason: 'conflict';
  createdAt: number;
  resolved: boolean;
}

/** A note's live-sync session as main holds it (D-103): the document, its version and the joined views. */
export interface FakeSession {
  epoch: string;
  version: number;
  doc: PmNode;
  log: Array<{ step: { stepType: string }; clientID: string }>;
  members: Set<string>;
  dirty: boolean;
}

export interface FakeVersion {
  id: string;
  noteId: string;
  format: 'rich' | 'plain';
  content: unknown;
  reason: 'conversion' | 'conflict' | 'restore';
  createdAt: number;
}

/** A locked note in the fake: its password, whether its key is in memory, Windows Hello and its sticky PIN. */
interface FakeLock {
  password: string;
  unlocked: boolean;
  hello: boolean;
  pin: string | null;
}

export interface FakeNote extends NoteDtoType {
  content: unknown;
  format: 'rich' | 'plain';
  deletedAt: number | null;
  batch: string | null;
}

/** A document as main holds it (D-118): the DTO, its trash state, a linked original's state and its saves. */
export interface FakeDocument extends DocumentDtoType {
  deletedAt: number | null;
  batch: string | null;
  file: DocumentFileInfoType | null;
  /** The bytes of each save, oldest first. */
  saves: Uint8Array[];
  /** Earlier versions, newest first: each save keeps the revision it replaced (D-119). */
  versions: DocumentVersionDtoType[];
  /** What `document:readWorkbook` answers for a spreadsheet, and the workbooks saved, oldest first. */
  workbook: DocumentReadWorkbookResponseType | null;
  workbookSaves: WorkbookType[];
}

export interface FakeBridgeOptions {
  /** Emit tree:changed after each mutation, like the real main process. Default true. */
  autoEvents?: boolean;
  info?: Partial<{ version: string }>;
}

/** A rich document with an ID on every block type that carries one. */
function withBlockIds(doc: unknown): unknown {
  const walk = (node: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }): unknown => ({
    ...node,
    ...((BLOCK_ID_TYPES as readonly string[]).includes(node.type ?? '') && !node.attrs?.id ? { attrs: { ...node.attrs, id: uid() } } : {}),
    ...(node.content ? { content: node.content.map((c) => walk(c as typeof node)) } : {}),
  });
  return walk(doc as { content?: unknown[] });
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
  const documents: FakeDocument[] = [];
  /** Comment threads by ID (D-165). */
  const threads = new Map<string, CommentThreadDtoType>();
  /** Files the fake picker returns next: names and sizes. */
  const documentPicks: Array<Array<{ name: string; sizeBytes: number }>> = [];
  /** Document hand-offs to the OS, as "open:<id>" or "show:<id>". */
  const documentHandoffs: string[] = [];
  const sessions = new Map<string, FakeSession>();
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const drafts: FakeDraft[] = [];
  const versions: FakeVersion[] = [];
  const imports: Array<{ kind: string; originalName?: string; size: number }> = [];
  const shellCalls: string[] = [];
  /** Attachment and linked-file hand-offs the renderer asked for, as "open:<id>" or "show:<id>". */
  const handoffs: string[] = [];
  const noteTags = new Map<string, string[]>();
  const subscribers = new Map<string, Set<(payload: unknown) => void>>();
  const failures = new Map<string, Array<{ code: ErrorCode; message: string; details?: unknown }>>();
  const calls: Array<{ channel: string; req: unknown }> = [];
  /** Notes whose sticky window is open, with its collapse and pin state. */
  const floating = new Map<string, { collapsed: boolean; alwaysOnTop: boolean; activation: number }>();
  /** Default text colors of stickies (not part of the note DTO). */
  const textColors = new Map<string, HexColor>();
  let windowState: WindowGetStateResponseType = { role: 'main', openNotes: [], openReminders: null, widget: { open: false, collapsed: false, alwaysOnTop: false } };
  /** Reminder state the tests arrange: the zone list, the view lists, the Home summary and each note's reminders. */
  const reminderData = {
    zones: { zones: ['America/Chicago', 'America/New_York', 'Asia/Dhaka', 'UTC'], systemZone: 'Asia/Dhaka', defaultZone: 'Asia/Dhaka', asOf: Date.parse('2026-10-08T07:00:00Z') } as ZonesListResponseType,
    views: { today: [], upcoming: [], overdue: [], completed: [] } as Record<ReminderViewType, OccurrenceItemType[]>,
    summary: null as RemindersSummaryResponseType | null,
    byNote: new Map<string, ReminderDtoType[]>(),
    deleted: new Map<string, ReminderDtoType>(),
    /** Each note's dismissed suggestions, newest first. */
    dismissals: new Map<string, DismissalDtoType[]>(),
  };
  /** The widget window and launch-at-login state main would report. */
  const windowData = {
    widget: { open: false, collapsed: false, alwaysOnTop: false } as WidgetStateType,
    autostart: { enabled: false, capability: { status: 'unsupported', reason: 'development-build' } } as AutostartStateType,
  };
  /** What the Phase 08 channels answer: backup status and the global shortcut (main does the file work). */
  const portabilityData = {
    status: { auto: { enabled: false, directory: null, intervalDays: 7, keep: 5 }, lastAuto: null, rollbackCopies: [], lastRestore: null } as BackupStatusType,
    shortcut: { enabled: false, accelerator: 'CommandOrControl+Alt+N', registered: false, error: null, capability: { status: 'supported', reason: 'native-windows' } } as ShortcutStateType,
  };
  let capabilities: CapabilitiesType | null = null;
  let clock = 1_000;
  /** Locked notes (D-111): each one's password, whether it is unlocked, Windows Hello and the sticky PIN (D-173). */
  const lockData = {
    locks: new Map<string, FakeLock>(),
    /** Notes whose sticky main has revealed (D-172), and wrong PINs in a row. */
    revealed: new Set<string>(),
    pinFailures: new Map<string, number>(),
    osKey: { status: 'unsupported', reason: 'Linux has no OS key that Infinity Notes can verify. Use a password.' } as OsKeyAvailabilityType,
  };
  const lockStatus = (noteId: string): LockStatusType => {
    const lock = lockData.locks.get(noteId);
    return { noteId, locked: !!lock, unlocked: !!lock?.unlocked, hello: !!lock?.hello, pin: !!lock?.pin, retryInSeconds: 0 };
  };
  const stickyLockState = (noteId: string): StickyLockStateType => {
    const lock = lockData.locks.get(noteId);
    return {
      noteId,
      locked: !!lock,
      revealed: !!lock?.unlocked && lockData.revealed.has(noteId),
      keyInMemory: !!lock?.unlocked,
      pinSet: !!lock?.pin,
      pinBlocked: (lockData.pinFailures.get(noteId) ?? 0) >= PIN_STRIKES,
      hello: !!lock?.hello,
      retryInSeconds: 0,
    };
  };
  const blurSticky = (noteId: string) => {
    if (lockData.revealed.delete(noteId)) emit('sticky:lockState', stickyLockState(noteId));
  };
  /** The note's lock after the password check, or the failure main would answer. */
  const checkedLock = (noteId: string, password: string): FakeLock | Result<never> => {
    const lock = lockData.locks.get(noteId);
    if (!lock) return fail('VALIDATION_FAILED', LOCK_MESSAGES.notLocked);
    if (lock.password !== password) return fail('VALIDATION_FAILED', LOCK_MESSAGES.wrongPassword, { wrongPassword: true, retryInSeconds: 0 });
    return lock;
  };
  const isFailure = (v: unknown): v is Result<never> => typeof v === 'object' && v !== null && 'ok' in v;
  const lockedOut = (noteId: string): Result<never> | null => {
    const lock = lockData.locks.get(noteId);
    return lock && !lock.unlocked ? fail('FORBIDDEN', LOCK_MESSAGES.locked, { locked: true }) : null;
  };
  const relock = (noteId: string) => {
    const lock = lockData.locks.get(noteId);
    if (!lock?.unlocked) return false;
    lock.unlocked = false;
    resetSession(noteId);
    blurSticky(noteId);
    return true;
  };

  const setPin = (req: { noteId: string; password: string; pin: string | null }): Result<LockStatusType> => {
    const lock = checkedLock(req.noteId, req.password);
    if (isFailure(lock)) return lock;
    if (req.pin !== null && !PIN_RE.test(req.pin)) return fail('VALIDATION_FAILED', LOCK_MESSAGES.pinFormat);
    lock.pin = req.pin;
    lockData.pinFailures.delete(req.noteId);
    return ok(lockStatus(req.noteId));
  };
  const reveal = (noteId: string, how: { kind: 'pin'; pin: string } | { kind: 'password'; password: string } | { kind: 'hello' }): Result<StickyLockStateType> => {
    const lock = lockData.locks.get(noteId);
    if (!lock) return fail('VALIDATION_FAILED', LOCK_MESSAGES.notLocked);
    if (how.kind === 'pin') {
      if (!lock.pin) return fail('VALIDATION_FAILED', LOCK_MESSAGES.pinNotSet);
      if (!lock.unlocked) return fail('FORBIDDEN', LOCK_MESSAGES.pinNeedsKey, { needsPassword: true });
      const failures = lockData.pinFailures.get(noteId) ?? 0;
      if (failures >= PIN_STRIKES) return fail('FORBIDDEN', LOCK_MESSAGES.pinStrikes, { needsPassword: true });
      if (how.pin !== lock.pin) {
        lockData.pinFailures.set(noteId, failures + 1);
        return fail('VALIDATION_FAILED', failures + 1 >= PIN_STRIKES ? LOCK_MESSAGES.pinStrikes : LOCK_MESSAGES.wrongPin, { wrongPin: true });
      }
    } else if (how.kind === 'password') {
      const checked = checkedLock(noteId, how.password);
      if (isFailure(checked)) return checked;
    } else if (!lock.hello) {
      return fail('VALIDATION_FAILED', LOCK_MESSAGES.helloOff);
    }
    lock.unlocked = true;
    lockData.pinFailures.delete(noteId);
    lockData.revealed.add(noteId);
    return ok(stickyLockState(noteId));
  };

  const emit = (channel: EventChannel, payload: unknown) => {
    for (const cb of subscribers.get(channel) ?? []) cb(payload);
  };
  const treeChanged = (reason: string, trashedNoteIds: string[] = [], trashedDocumentIds: string[] = []) => {
    if (autoEvents) emit('tree:changed', { reason, trashedNoteIds, trashedDocumentIds });
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
  const liveDocuments = () => documents.filter((d) => d.deletedAt === null);
  const documentDto = (d: FakeDocument): DocumentDtoType => {
    const { deletedAt: _d, batch: _b, file: _f, saves: _s, versions: _v, workbook: _w, workbookSaves: _ws, ...dto } = d;
    return dto;
  };
  const documentSummary = (d: FakeDocument) => ({ ...documentDto(d), path: pathOf(pathIndex(), { projectId: d.projectId, folderId: d.folderId }) });
  const addDocument = (fields: Pick<DocumentDtoType, 'projectId' | 'folderId' | 'title' | 'kind' | 'storage' | 'sizeBytes'>, file: DocumentFileInfoType | null = null): FakeDocument => {
    clock += 1;
    const d: FakeDocument = { id: uid(), ...fields, revision: 0, favorite: false, createdAt: clock, updatedAt: clock, deletedAt: null, batch: null, file, saves: [], versions: [], workbook: null, workbookSaves: [] };
    documents.push(d);
    treeChanged('create');
    return d;
  };
  /** A save or restore: the replaced revision becomes the newest version. */
  const nextRevision = (d: FakeDocument, reason: DocumentVersionDtoType['reason'], sizeBytes: number) => {
    clock += 1;
    d.versions.unshift({ id: uid(), revision: d.revision, reason, sizeBytes: d.sizeBytes, createdAt: clock });
    Object.assign(d, { revision: d.revision + 1, sizeBytes, updatedAt: clock });
  };
  const liveDocument = (documentId: string): FakeDocument | Result<never> => {
    const d = documents.find((x) => x.id === documentId);
    if (!d) return fail('NOT_FOUND', DOCUMENT_MESSAGES.missing);
    return d.deletedAt === null ? d : fail('NOT_FOUND', DOCUMENT_MESSAGES.inTrash);
  };
  const trashDocumentIds = (ids: string[], batch: string) => {
    for (const d of documents) if (ids.includes(d.id) && d.deletedAt === null) Object.assign(d, { deletedAt: clock, batch });
  };
  const stickyState = (n: FakeNote): StickyStateType => {
    const w = floating.get(n.id) ?? { collapsed: false, alwaysOnTop: false, activation: 0 };
    return {
      noteId: n.id,
      title: n.title,
      color: n.color ?? 'yellow',
      textColor: textColors.get(n.id) ?? null,
      path: pathOf(pathIndex(), { projectId: n.projectId, folderId: n.folderId }),
      trashed: n.deletedAt === null ? null : { batchId: n.batch },
      locked: n.locked,
      ...w,
    };
  };
  const stickyNote = (noteId: string): FakeNote | Result<never> => notes.find((x) => x.id === noteId) ?? fail('NOT_FOUND', 'This note no longer exists');

  const trashNoteIds = (ids: string[], batch: string) => {
    for (const n of notes) if (ids.includes(n.id) && n.deletedAt === null) Object.assign(n, { deletedAt: clock, batch });
  };

  /** Saves a session's document into its note, as main does a moment after an edit (D-103). */
  const saveSession = (noteId: string): number => {
    const n = notes.find((x) => x.id === noteId)!;
    const sess = sessions.get(noteId);
    if (!sess || !sess.dirty) return n.revision;
    const json = sess.doc.toJSON() as { content?: unknown[] };
    n.content = n.format === 'rich' ? toSavable(json) : docToText(json);
    n.revision += 1;
    clock += 1;
    n.updatedAt = clock;
    sess.dirty = false;
    emit('collab:status', { noteId, epoch: sess.epoch, savedVersion: sess.version, revision: n.revision, state: 'saved', message: null });
    return n.revision;
  };
  /** A write outside the session (conversion, restore, a whole-content save): its views join again. */
  const resetSession = (noteId: string) => {
    if (!sessions.delete(noteId)) return;
    emit('collab:reset', { noteId, conflict: null });
  };

  /** Revision checks shared by conversion and restores; applies the change and bumps the revision. */
  const contentOp = (
    req: ContentOpBaseType,
    change: (n: FakeNote) => { format: 'rich' | 'plain'; content: unknown; versionId: string | null } | Result<never>,
  ): Result<NoteContentResponseType> => {
    const n = notes.find((x) => x.id === req.noteId && x.deletedAt === null);
    if (!n) return fail('NOT_FOUND', 'That item no longer exists.');
    saveSession(n.id);
    if (n.revision !== req.baseRevision) return fail('CONFLICT', 'This note changed elsewhere', { currentRevision: n.revision, reason: 'stale' });
    const c = change(n);
    if ('ok' in c) return c;
    clock += 1;
    Object.assign(n, { format: c.format, content: c.content, revision: n.revision + 1, updatedAt: clock });
    resetSession(n.id);
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
  const sourceOf = (s: SuggestionSourceType, state: 'ok' | 'detached' = 'ok'): NonNullable<ReminderDtoType['source']> => ({
    blockId: s.blockId,
    text: s.text,
    spanOrdinal: s.spanOrdinal,
    origin: s.origin,
    state,
    referenceInstantUtc: s.referenceInstantUtc,
    referenceZone: s.referenceZone,
  });
  const replaceReminder = (dto: ReminderDtoType) => reminderData.byNote.set(dto.noteId, reminderData.byNote.get(dto.noteId)!.map((r) => (r.id === dto.id ? dto : r)));
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
      source: null,
    };
  };

  const threadOf = (threadId: string): Result<CommentThreadDtoType> => {
    const thread = threads.get(threadId);
    return thread ? ok(thread) : fail('NOT_FOUND', COMMENT_MESSAGES.missing);
  };
  const changeThread = (threadId: string, change: (t: CommentThreadDtoType) => CommentThreadDtoType) => {
    const found = threadOf(threadId);
    if (!found.ok) return found;
    const thread = change(found.data);
    threads.set(threadId, thread);
    return ok({ thread });
  };
  const threadWithComment = (commentId: string) => [...threads.values()].find((t) => t.comments.some((c) => c.id === commentId));
  const fakeGraph = () => {
    const items = [
      ...liveNotes().map((n) => ({ kind: 'note' as const, id: n.id, documentKind: null, title: n.title, locked: n.locked, projectId: n.projectId, folderId: n.folderId })),
      ...liveDocuments().map((d) => ({ kind: 'document' as const, id: d.id, documentKind: d.kind, title: d.title, locked: false, projectId: d.projectId, folderId: d.folderId })),
    ];
    const index = new Map(items.map((item, i) => [item.id, i]));
    const edges = liveNotes().flatMap((n) => [
      ...collectNoteRefs(n.content).map((r) => ({ source: index.get(n.id)!, target: index.get(r.targetNoteId), kind: 'reference' as const })),
      ...collectDocRefs(n.content).map((r) => ({ source: index.get(n.id)!, target: index.get(r.targetDocumentId), kind: 'documentLink' as const })),
    ]).filter((e): e is { source: number; target: number; kind: 'reference' | 'documentLink' } => e.target !== undefined && e.target !== e.source);
    const degree = (i: number) => edges.filter((e) => e.source === i || e.target === i).length;
    return { nodes: items.map((item, i) => ({ ...item, degree: degree(i) })), edges, truncated: false };
  };

  const bridge: InfinityBridge = {
    comments: {
      list: (req) => handle('comment:list', req, () => ok({ threads: [...threads.values()].filter((t) => t.target.kind === req.target.kind && t.target.id === req.target.id) })),
      create: (req) =>
        handle('comment:create', req, () => {
          const thread: CommentThreadDtoType = {
            id: uid(),
            target: req.target,
            anchor: req.anchor,
            quote: req.quote,
            resolvedAt: null,
            createdAt: clock,
            updatedAt: clock,
            comments: [{ id: uid(), body: req.body.trim(), createdAt: clock, updatedAt: clock }],
          };
          threads.set(thread.id, thread);
          return ok({ thread });
        }),
      reply: (req) =>
        handle('comment:reply', req, () =>
          changeThread(req.threadId, (t) => ({ ...t, comments: [...t.comments, { id: uid(), body: req.body.trim(), createdAt: clock, updatedAt: clock }] })),
        ),
      edit: (req) =>
        handle('comment:edit', req, () => {
          const thread = threadWithComment(req.commentId);
          if (!thread) return fail('NOT_FOUND', COMMENT_MESSAGES.missing);
          return changeThread(thread.id, (t) => ({ ...t, comments: t.comments.map((c) => (c.id === req.commentId ? { ...c, body: req.body.trim(), updatedAt: clock } : c)) }));
        }),
      delete: (req) =>
        handle('comment:delete', req, () => {
          const thread = threadWithComment(req.commentId);
          if (!thread) return fail('NOT_FOUND', COMMENT_MESSAGES.missing);
          if (thread.comments[0]!.id === req.commentId) return fail('VALIDATION_FAILED', COMMENT_MESSAGES.firstComment);
          return changeThread(thread.id, (t) => ({ ...t, comments: t.comments.filter((c) => c.id !== req.commentId) }));
        }),
      deleteThread: (req) =>
        handle('comment:deleteThread', req, () => (threads.delete(req.threadId) ? ok({ deleted: true as const }) : fail('NOT_FOUND', COMMENT_MESSAGES.missing))),
      resolve: (req) => handle('comment:resolve', req, () => changeThread(req.threadId, (t) => ({ ...t, resolvedAt: req.resolved ? clock : null }))),
    },
    graph: {
      build: (req) => handle('graph:build', req, () => ok(fakeGraph())),
      local: (req) => handle('graph:local', req, () => ok(fakeGraph())),
    },
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
      // The native picker is not faked: it is always canceled.
      pickFiles: (req) => handle('attachment:pickFiles', req, () => ok({ canceled: true, pickId: null, files: [], truncated: false, rejected: [] })),
      addPicked: (req) => handle('attachment:addPicked', req, () => fail('NOT_FOUND', 'The file could not be added.')),
      open: (req) =>
        handle('attachment:open', req, () => {
          handoffs.push(`open:${req.attachmentId}`);
          return ok({ opened: true as const });
        }),
      showInFolder: (req) =>
        handle('attachment:showInFolder', req, () => {
          handoffs.push(`show:${req.attachmentId}`);
          return ok({ shown: true as const });
        }),
    },
    lock: {
      availability: () => handle('lock:availability', {}, () => ok(lockData.osKey)),
      status: (req) => handle('lock:status', req, () => ok(lockStatus(req.noteId))),
      set: (req) =>
        handle('lock:set', req, () => {
          const n = notes.find((x) => x.id === req.noteId);
          if (!n) return fail('NOT_FOUND', 'That item no longer exists.');
          if (lockData.locks.has(n.id)) return fail('VALIDATION_FAILED', LOCK_MESSAGES.alreadyLocked);
          lockData.locks.set(n.id, { password: req.password, unlocked: false, hello: req.hello, pin: req.pin ?? null });
          n.locked = true;
          resetSession(n.id);
          treeChanged('lock');
          return ok(lockStatus(n.id));
        }),
      unlock: (req) =>
        handle('lock:unlock', req, () => {
          const lock = checkedLock(req.noteId, req.password);
          if (isFailure(lock)) return lock;
          lock.unlocked = true;
          return ok(lockStatus(req.noteId));
        }),
      unlockHello: (req) =>
        handle('lock:unlockHello', req, () => {
          const lock = lockData.locks.get(req.noteId);
          if (!lock?.hello) return fail('VALIDATION_FAILED', LOCK_MESSAGES.helloOff);
          lock.unlocked = true;
          return ok(lockStatus(req.noteId));
        }),
      lockNow: (req) =>
        handle('lock:lockNow', req, () => {
          relock(req.noteId);
          return ok(lockStatus(req.noteId));
        }),
      lockAll: () => handle('lock:lockAll', {}, () => ok({ locked: [...lockData.locks.keys()].filter((id) => relock(id)).length })),
      changePassword: (req) =>
        handle('lock:changePassword', req, () => {
          const lock = checkedLock(req.noteId, req.currentPassword);
          if (isFailure(lock)) return lock;
          lock.password = req.newPassword;
          return ok(lockStatus(req.noteId));
        }),
      setHello: (req) =>
        handle('lock:setHello', req, () => {
          const lock = checkedLock(req.noteId, req.password);
          if (isFailure(lock)) return lock;
          lock.hello = req.enabled;
          return ok(lockStatus(req.noteId));
        }),
      remove: (req) =>
        handle('lock:remove', req, () => {
          const lock = checkedLock(req.noteId, req.password);
          if (isFailure(lock)) return lock;
          lockData.locks.delete(req.noteId);
          const n = notes.find((x) => x.id === req.noteId);
          if (n) n.locked = false;
          resetSession(req.noteId);
          treeChanged('lock');
          return ok(lockStatus(req.noteId));
        }),
      create: (req) =>
        handle('lock:create', req, () => {
          if (req.password.length < 8) return fail('VALIDATION_FAILED', LOCK_MESSAGES.tooShort);
          if (req.pin && !PIN_RE.test(req.pin)) return fail('VALIDATION_FAILED', LOCK_MESSAGES.pinFormat);
          clock += 1;
          const n: FakeNote = {
            id: uid(),
            projectId: req.location.projectId,
            folderId: req.location.folderId,
            title: '',
            sticky: req.sticky,
            color: req.sticky ? 'yellow' : null,
            pinnedAt: null,
            favorite: false,
            revision: 0,
            locked: true,
            createdAt: clock,
            updatedAt: clock,
            content: { type: 'doc', content: [{ type: 'paragraph' }] },
            format: 'rich',
            deletedAt: null,
            batch: null,
          };
          notes.push(n);
          lockData.locks.set(n.id, { password: req.password, unlocked: true, hello: req.hello, pin: req.pin ?? null });
          if (req.sticky) {
            floating.set(n.id, { collapsed: false, alwaysOnTop: false, activation: 1 });
            lockData.revealed.add(n.id);
          }
          treeChanged('create');
          return ok({ note: dto(n) });
        }),
      setPin: (req) => handle('lock:setPin', req, () => setPin(req)),
    },
    fileLink: {
      // jsdom files are never on disk, like a File made by page script (D-115).
      createFromFile: async () => fail('VALIDATION_FAILED', LINK_MESSAGES.noPath),
      isOnDisk: () => false,
      status: (req) => handle('fileLink:status', req, () => ok({ path: null, sizeBytes: null, state: 'missing' as const })),
      open: (req) =>
        handle('fileLink:open', req, () => {
          handoffs.push(`open:${req.linkId}`);
          return ok({ opened: true as const });
        }),
      showInFolder: (req) =>
        handle('fileLink:showInFolder', req, () => {
          handoffs.push(`show:${req.linkId}`);
          return ok({ shown: true as const });
        }),
      copyIn: (req) => handle('fileLink:copyIn', req, () => fail('NOT_FOUND', 'This linked file is no longer available')),
    },
    refs: {
      list: (req) =>
        handle('refs:list', req, () => {
          const byId = new Map(notes.map((n) => [n.id, n]));
          const outgoing = collectNoteRefs(byId.get(req.noteId)?.content).map((r) => {
            const t = byId.get(r.targetNoteId);
            const state = !t ? ('missing' as const) : t.deletedAt !== null ? ('trashed' as const) : ('ok' as const);
            return { targetNoteId: r.targetNoteId, targetBlockId: r.targetBlockId, title: t?.title ?? r.label, path: [], state, trashBatchId: t?.batch ?? null, blockText: null };
          });
          const backlinks = liveNotes()
            .filter((n) => n.id !== req.noteId)
            .flatMap((n) =>
              collectNoteRefs(n.content)
                .filter((r) => r.targetNoteId === req.noteId)
                .map((r) => ({ sourceNoteId: n.id, sourceBlockId: r.sourceBlockId, targetBlockId: r.targetBlockId, title: n.title, path: [], context: '' })),
            );
          const documentRefs = collectDocRefs(byId.get(req.noteId)?.content).map((r) => {
            const d = documents.find((x) => x.id === r.targetDocumentId);
            const state = !d ? ('missing' as const) : d.deletedAt !== null ? ('trashed' as const) : ('ok' as const);
            return { targetDocumentId: r.targetDocumentId, target: r.target, title: d?.title ?? r.label, kind: d?.kind ?? null, path: [], state, trashBatchId: d?.batch ?? null };
          });
          return ok({ outgoing, documents: documentRefs, backlinks });
        }),
      documentBacklinks: (req) =>
        handle('refs:documentBacklinks', req, () =>
          ok({
            backlinks: liveNotes().flatMap((n) =>
              collectDocRefs(n.content)
                .filter((r) => r.targetDocumentId === req.documentId)
                .map((r) => ({ sourceNoteId: n.id, sourceBlockId: r.sourceBlockId, target: r.target, title: n.title, path: [], context: '' })),
            ),
          }),
        ),
    },
    links: {
      search: (req) =>
        handle('links:search', req, () => {
          const items = [
            ...liveNotes().map((n) => ({ kind: 'note' as const, id: n.id, title: n.title, path: summary(n).path, locked: n.locked, updatedAt: n.updatedAt })),
            ...liveDocuments().map((d) => ({ kind: 'document' as const, id: d.id, title: d.title, path: documentSummary(d).path, documentKind: d.kind, updatedAt: d.updatedAt })),
          ];
          return ok({ items: rankByTitle(req.query, items, (i) => i.title || 'Untitled', (i) => i.updatedAt).map(({ updatedAt: _u, ...item }) => item) });
        }),
    },
    notes: {
      pick: (req) =>
        handle<NotesPickResponseType>('notes:pick', req, () => {
          const n = notes.find((x) => x.id === req.noteId && x.deletedAt === null);
          if (!n) return fail('NOT_FOUND', 'This note no longer exists');
          if (n.format === 'plain') return ok({ format: 'plain' as const, blocks: [] });
          const q = req.query.toLowerCase();
          const blocks = textBlocksOf(n.content)
            .filter((b) => b.text !== '' && b.text.toLowerCase().includes(q))
            .map((b) => ({ blockId: b.id, kind: b.kind, text: b.text }));
          return ok({ format: 'rich' as const, blocks });
        }),
    },
    search: {
      query: (req) =>
        handle('search:query', req, () => {
          const q = req.query.trim().toLowerCase();
          if (!q) return ok({ results: [], documents: [] });
          const matchedDocuments = (req.tags ?? []).length > 0 ? [] : liveDocuments().filter((d) => d.title.toLowerCase().includes(q));
          const results = liveNotes()
            .filter((n) => `${n.title} ${extractPlainText(n.format, n.content)}`.toLowerCase().includes(q))
            .filter((n) => (req.tags ?? []).every((t) => (noteTags.get(n.id) ?? []).includes(t)))
            .slice(0, req.limit ?? 50)
            .map((n) => ({ note: summary(n), title: [{ text: n.title || 'Untitled', hit: false }], snippet: [{ text: extractPlainText(n.format, n.content).slice(0, 80), hit: false }] }));
          return ok({ results, documents: matchedDocuments.map((d) => ({ document: documentSummary(d), title: [{ text: d.title, hit: false }], snippet: [] })) });
        }),
    },
    tags: {
      list: (req) =>
        handle('tags:list', req, () => {
          if (req.noteId) return ok({ tags: (noteTags.get(req.noteId) ?? []).map((name) => ({ name, count: 1 })) });
          const counts = new Map<string, number>();
          for (const list of noteTags.values()) for (const name of list) counts.set(name, (counts.get(name) ?? 0) + 1);
          return ok({ tags: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count })) });
        }),
      set: (req) =>
        handle('tags:set', req, () => {
          const tags = [...new Set(req.tags)].sort();
          noteTags.set(req.noteId, tags);
          return ok({ tags });
        }),
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
            documents: liveDocuments().map(documentDto),
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
          const documentIds = liveDocuments().filter((d) => d.projectId === p.id).map((d) => d.id);
          trashDocumentIds(documentIds, batch);
          treeChanged('trash', ids, documentIds);
          return ok({ trashBatchId: batch, counts: { projects: 1, folders: f.length, notes: ids.length, documents: documentIds.length }, trashedNoteIds: ids, trashedDocumentIds: documentIds });
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
          const documentIds: string[] = [];
          const walk = (id: string) => {
            const node = folders.find((x) => x.id === id)!;
            Object.assign(node, { deletedAt: clock, batch });
            for (const n of liveNotes().filter((x) => x.folderId === id)) ids.push(n.id);
            for (const d of liveDocuments().filter((x) => x.folderId === id)) documentIds.push(d.id);
            for (const child of folders.filter((x) => x.parentId === id && x.deletedAt === null)) walk(child.id);
          };
          walk(f.id);
          trashNoteIds(ids, batch);
          trashDocumentIds(documentIds, batch);
          treeChanged('trash', ids, documentIds);
          return ok({ trashBatchId: batch, counts: { projects: 0, folders: 1, notes: ids.length, documents: documentIds.length }, trashedNoteIds: ids, trashedDocumentIds: documentIds });
        }),
    },
    note: {
      print: (req) => handle('note:print', req, () => ok({ printed: true })),
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
            locked: false,
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
          return ok({ trashBatchId: batch, counts: { projects: 0, folders: 0, notes: 1, documents: 0 }, trashedNoteIds: [n.id], trashedDocumentIds: [] });
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
          const locked = lockedOut(n.id);
          if (locked) return locked;
          return ok({ note: summary(n), format: n.format, content: n.content as never, revision: n.revision });
        }),
      save: (req) =>
        handle('note:save', req, () => {
          const n = notes.find((x) => x.id === req.noteId);
          if (!n) return fail('NOT_FOUND', 'Note not found');
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
          resetSession(n.id);
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
    collab: {
      join: (req) =>
        handle('collab:join', req, () => {
          const n = notes.find((x) => x.id === req.noteId);
          if (!n) return fail('NOT_FOUND', 'That item no longer exists.');
          if (n.deletedAt !== null) return fail('NOT_FOUND', 'This note is in Trash', { trashed: true, trashBatchId: n.batch });
          const locked = lockedOut(n.id);
          if (locked) return locked;
          let sess = sessions.get(n.id);
          if (!sess) {
            // Like main, the session gives blocks their IDs once, so no editor has to (D-103).
            const json = n.format === 'rich' ? withBlockIds(n.content ?? { type: 'doc', content: [{ type: 'paragraph' }] }) : textToDoc(String(n.content ?? ''));
            sess = { epoch: uid(), version: 0, doc: noteSchema(n.format).nodeFromJSON(json), log: [], members: new Set(), dirty: false };
            sessions.set(n.id, sess);
          }
          sess.members.add(req.viewId);
          return ok({ epoch: sess.epoch, version: sess.version, format: n.format, doc: sess.doc.toJSON(), revision: n.revision });
        }),
      push: (req) =>
        handle<ChannelResponse<'collab:push'>>('collab:push', req, () => {
          const sess = sessions.get(req.noteId);
          const n = notes.find((x) => x.id === req.noteId)!;
          if (!sess || !sess.members.has(req.viewId) || sess.epoch !== req.epoch) return ok({ status: 'reset' as const });
          if (req.version !== sess.version) return ok({ status: 'behind' as const, version: sess.version });
          const start = sess.version;
          for (const json of req.steps) {
            const result = Step.fromJSON(noteSchema(n.format), json).apply(sess.doc);
            if (!result.doc) return fail('VALIDATION_FAILED', 'These edits could not be applied');
            sess.doc = result.doc;
            sess.log.push({ step: json, clientID: req.viewId });
          }
          sess.version += req.steps.length;
          sess.dirty = true;
          clearTimeout(saveTimers.get(req.noteId));
          saveTimers.set(req.noteId, setTimeout(() => saveSession(req.noteId), 400));
          emit('collab:steps', { noteId: req.noteId, epoch: sess.epoch, version: start, steps: req.steps, clientIDs: req.steps.map(() => req.viewId) });
          return ok({ status: 'accepted' as const, version: sess.version });
        }),
      pull: (req) =>
        handle<ChannelResponse<'collab:pull'>>('collab:pull', req, () => {
          const sess = sessions.get(req.noteId);
          if (!sess || sess.epoch !== req.epoch) return ok({ status: 'reset' as const });
          const missing = sess.log.slice(req.version);
          return ok({ status: 'steps' as const, version: req.version, steps: missing.map((m) => m.step), clientIDs: missing.map((m) => m.clientID) });
        }),
      flush: (req) =>
        handle('collab:flush', req, () => {
          const n = notes.find((x) => x.id === req.noteId);
          if (!n) return fail('NOT_FOUND', 'That item no longer exists.');
          clearTimeout(saveTimers.get(req.noteId));
          const sess = sessions.get(req.noteId);
          if (sess && req.force) sess.dirty = true;
          if (sess?.dirty && n.deletedAt !== null) {
            const draftId = uid();
            const json = sess.doc.toJSON() as { content?: unknown[] };
            drafts.push({ id: draftId, noteId: n.id, content: n.format === 'rich' ? toSavable(json) : docToText(json), format: n.format, baseRevision: n.revision, reason: 'conflict', createdAt: clock, resolved: false });
            sessions.delete(n.id);
            return fail('CONFLICT', 'This note changed elsewhere', { currentRevision: n.revision, draftId, reason: 'trashed' });
          }
          return ok({ revision: saveSession(req.noteId) });
        }),
      leave: (req) =>
        handle<ChannelResponse<'collab:leave'>>('collab:leave', req, () => {
          const sess = sessions.get(req.noteId);
          if (!sess?.members.delete(req.viewId)) return ok({ left: false });
          if (sess.members.size === 0) {
            clearTimeout(saveTimers.get(req.noteId));
            saveSession(req.noteId);
            sessions.delete(req.noteId);
          }
          return ok({ left: true });
        }),
    },
    trash: {
      list: () =>
        handle('trash:list', {}, () => {
          const items: TrashItemType[] = [];
          for (const p of projects.filter((x) => x.deletedAt !== null)) {
            items.push({ batchId: p.batch!, kind: 'project', id: p.id, label: p.name, sticky: false, deletedAt: p.deletedAt!, fromPath: [], contains: { folders: 0, notes: 0, documents: 0 }, documentKind: null });
          }
          const batchesWithProject = new Set(projects.map((p) => p.batch));
          const seen = new Set<string>();
          for (const f of folders.filter((x) => x.deletedAt !== null && !batchesWithProject.has(x.batch))) {
            if (seen.has(f.batch!)) continue;
            const root = folders.filter((x) => x.batch === f.batch).find((x) => x.parentId === null || folders.find((y) => y.id === x.parentId)?.batch !== f.batch)!;
            seen.add(f.batch!);
            items.push({ batchId: f.batch!, kind: 'folder', id: root.id, label: root.name, sticky: false, deletedAt: root.deletedAt!, fromPath: [], contains: { folders: 0, notes: 0, documents: 0 }, documentKind: null });
          }
          const batchesWithFolder = new Set(folders.map((f) => f.batch));
          for (const n of notes.filter((x) => x.deletedAt !== null && !batchesWithFolder.has(x.batch) && !batchesWithProject.has(x.batch))) {
            items.push({ batchId: n.batch!, kind: 'note', id: n.id, label: n.title, sticky: n.sticky, deletedAt: n.deletedAt!, fromPath: [], contains: { folders: 0, notes: 0, documents: 0 }, documentKind: null });
          }
          const batchesWithNote = new Set(notes.map((n) => n.batch));
          for (const d of documents.filter((x) => x.deletedAt !== null && !batchesWithFolder.has(x.batch) && !batchesWithProject.has(x.batch) && !batchesWithNote.has(x.batch))) {
            items.push({ batchId: d.batch!, kind: 'document', id: d.id, label: d.title, sticky: false, deletedAt: d.deletedAt!, fromPath: [], contains: { folders: 0, notes: 0, documents: 0 }, documentKind: d.kind });
          }
          return ok({ items });
        }),
      restore: (req) =>
        handle('trash:restore', req, () => {
          const touched = [...projects, ...folders, ...notes, ...documents].filter((x) => x.batch === req.batchId);
          if (touched.length === 0) return fail('NOT_FOUND', 'That item is no longer in Trash.');
          const restoredNoteIds = notes.filter((n) => n.batch === req.batchId).map((n) => n.id);
          const restoredDocumentIds = documents.filter((d) => d.batch === req.batchId).map((d) => d.id);
          for (const x of touched) Object.assign(x, { deletedAt: null, batch: null });
          const root = touched[0]!;
          const kind = projects.includes(root as never) ? 'project' : folders.includes(root as never) ? 'folder' : notes.includes(root as never) ? 'note' : 'document';
          treeChanged('restore');
          return ok({ kind, id: root.id, relocated: false, location: { projectId: null, folderId: null }, path: ['Common'], restoredNoteIds, restoredDocumentIds });
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
          const purged = { projects: count(projects), folders: count(folders), notes: count(notes), documents: count(documents) };
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
          const recentDocuments = liveDocuments()
            .filter((d) => scope.kind === 'all' || (scope.kind === 'common' ? d.projectId === null : d.projectId === (scope as { projectId: string }).projectId))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 10);
          return ok({ scope, scopeValid, pinned: pinned.map(summary), pinnedTotal: pinned.length, recent: recent.map(summary), recentDocuments: recentDocuments.map(documentSummary) });
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
      lockStatus: (req) => handle('sticky:lockStatus', req, () => ok(stickyLockState(req.noteId))),
      reveal: (req) => handle('sticky:reveal', req, () => reveal(req.noteId, req.with)),
      activity: (req) => handle('sticky:activity', req, () => ok({})),
      blur: (req) =>
        handle('sticky:blur', req, () => {
          lockData.revealed.delete(req.noteId);
          return ok(stickyLockState(req.noteId));
        }),
      setPin: (req) =>
        handle('sticky:setPin', req, () => {
          const res = setPin(req);
          return res.ok ? ok(stickyLockState(req.noteId)) : res;
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
      setTextColor: (req) =>
        handle('sticky:setTextColor', req, () => {
          const n = stickyNote(req.noteId);
          if ('ok' in n) return n;
          if (!n.sticky) return fail('VALIDATION_FAILED', 'This note is not a sticky');
          if (req.textColor) textColors.set(n.id, req.textColor);
          else textColors.delete(n.id);
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
          return ok({ kind: 'note' as const, id: n.id, relocated: false, location: { projectId: null, folderId: null }, path: ['Common'], restoredNoteIds: [n.id], restoredDocumentIds: [] });
        }),
    },
    document: {
      create: (req) =>
        handle('document:create', req, () => {
          const d = addDocument({ ...req.location, title: req.title ?? DOCUMENT_KIND_INFO[req.kind].blankTitle, kind: req.kind, storage: 'managed', sizeBytes: 1000 });
          return ok({ document: documentDto(d) });
        }),
      pickFiles: () =>
        handle('document:pickFiles', {}, () => {
          const files = documentPicks.shift();
          return ok(files ? { canceled: false, pickId: uid(), files, truncated: false, rejected: [] } : { canceled: true, pickId: null, files: [], truncated: false, rejected: [] });
        }),
      addPicked: (req) =>
        handle('document:addPicked', req, () => {
          const d = addDocument({ ...req.location, title: `Picked ${req.index}`, kind: 'pdf', storage: req.action === 'link' ? 'linked' : 'managed', sizeBytes: 100 });
          return ok({ document: documentDto(d) });
        }),
      fromAttachment: (req) =>
        handle('document:fromAttachment', req, () => ok({ document: documentDto(addDocument({ projectId: null, folderId: null, title: 'From attachment', kind: 'xlsx', storage: 'managed', sizeBytes: 10 })), created: true })),
      fromLink: (req) =>
        handle('document:fromLink', req, () => ok({ document: documentDto(addDocument({ projectId: null, folderId: null, title: 'From link', kind: 'pdf', storage: 'linked', sizeBytes: 10 })), created: true })),
      open: (req) =>
        handle('document:open', req, () => {
          const d = liveDocument(req.documentId);
          return 'ok' in d ? d : ok({ document: documentDto(d), file: d.file });
        }),
      save: (req) =>
        handle('document:save', req, () => {
          const d = liveDocument(req.documentId);
          if ('ok' in d) return d;
          if (req.baseRevision !== d.revision) return fail('CONFLICT', DOCUMENT_MESSAGES.revisionChanged, { reason: 'revision', currentRevision: d.revision });
          nextRevision(d, 'save', req.bytes.byteLength);
          d.saves.push(req.bytes);
          return ok({ document: documentDto(d), file: d.file });
        }),
      saveWorkbook: (req) =>
        handle('document:saveWorkbook', req, () => {
          const d = liveDocument(req.documentId);
          if ('ok' in d) return d;
          if (req.baseRevision !== d.revision) return fail('CONFLICT', DOCUMENT_MESSAGES.revisionChanged, { reason: 'revision', currentRevision: d.revision });
          nextRevision(d, 'save', d.sizeBytes);
          d.workbookSaves.push(req.workbook);
          return ok({ document: documentDto(d), file: d.file });
        }),
      readWorkbook: (req) =>
        handle('document:readWorkbook', req, () => {
          const d = liveDocument(req.documentId);
          if ('ok' in d) return d;
          return d.workbook ? ok(d.workbook) : fail('VALIDATION_FAILED', DOCUMENT_MESSAGES.damaged(d.kind));
        }),
      saveCopy: (req) =>
        handle('document:saveCopy', req, () => {
          const d = liveDocument(req.documentId);
          if ('ok' in d) return d;
          return ok({ canceled: false as const, document: documentDto(addDocument({ ...d, title: `${d.title} (copy)`, storage: 'linked' })) });
        }),
      rename: (req) =>
        handle('document:rename', req, () => {
          const d = liveDocument(req.documentId);
          if ('ok' in d) return d;
          d.title = req.title;
          treeChanged('rename');
          return ok({ document: documentDto(d) });
        }),
      move: (req) =>
        handle('document:move', req, () => {
          const d = liveDocument(req.documentId);
          if ('ok' in d) return d;
          Object.assign(d, req.target);
          treeChanged('move');
          return ok({ document: documentDto(d) });
        }),
      trash: (req) =>
        handle('document:trash', req, () => {
          const d = liveDocument(req.documentId);
          if ('ok' in d) return d;
          const batch = uid();
          clock += 1;
          trashDocumentIds([d.id], batch);
          treeChanged('trash', [], [d.id]);
          return ok({ trashBatchId: batch, counts: { projects: 0, folders: 0, notes: 0, documents: 1 }, trashedNoteIds: [], trashedDocumentIds: [d.id] });
        }),
      versions: (req) =>
        handle('document:versions', req, () => {
          const d = liveDocument(req.documentId);
          return 'ok' in d ? d : ok({ versions: d.versions });
        }),
      restoreVersion: (req) =>
        handle('document:restoreVersion', req, () => {
          const d = liveDocument(req.documentId);
          if ('ok' in d) return d;
          const version = d.versions.find((v) => v.id === req.versionId);
          if (!version) return fail('NOT_FOUND', DOCUMENT_MESSAGES.versionMissing);
          if (req.baseRevision !== d.revision) return fail('CONFLICT', DOCUMENT_MESSAGES.revisionChanged, { reason: 'revision', currentRevision: d.revision });
          nextRevision(d, 'restore', version.sizeBytes);
          return ok({ document: documentDto(d), file: d.file });
        }),
      copyVersion: (req) =>
        handle('document:copyVersion', req, () => {
          const d = liveDocument(req.documentId);
          if ('ok' in d) return d;
          const version = d.versions.find((v) => v.id === req.versionId);
          if (!version) return fail('NOT_FOUND', DOCUMENT_MESSAGES.versionMissing);
          const copy = addDocument({ projectId: d.projectId, folderId: d.folderId, title: `${d.title} (revision ${version.revision})`, kind: d.kind, storage: 'managed', sizeBytes: version.sizeBytes });
          return ok({ document: documentDto(copy) });
        }),
      exportCopy: (req) =>
        handle('document:export', req, () => {
          const d = liveDocument(req.documentId);
          if ('ok' in d) return d;
          documentHandoffs.push(`export:${req.documentId}:${req.versionId ?? 'current'}`);
          return ok({ canceled: false });
        }),
      openExternal: (req) =>
        handle('document:openExternal', req, () => {
          documentHandoffs.push(`open:${req.documentId}`);
          return ok({ opened: true as const });
        }),
      showInFolder: (req) =>
        handle('document:showInFolder', req, () => {
          documentHandoffs.push(`show:${req.documentId}`);
          return ok({ shown: true as const });
        }),
      pickPdf: () => handle('document:pickPdf', {}, () => ok({ canceled: true as const })),
      createBeside: (req) =>
        handle('document:createBeside', req, () => {
          const source = liveDocument(req.documentId);
          if ('ok' in source) return source;
          const d = addDocument({ projectId: source.projectId, folderId: source.folderId, title: req.title, kind: source.kind, storage: 'managed', sizeBytes: req.bytes.byteLength });
          return ok({ document: documentDto(d) });
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
      createFromSuggestion: (req) =>
        handle<ReminderCreateFromSuggestionResponseType>('reminder:createFromSuggestion', req, () => {
          const text = normalizePhrase(req.source.text);
          const linked = (reminderData.byNote.get(req.noteId) ?? []).find(
            (r) => r.source && r.source.state !== 'detached' && r.source.blockId === req.source.blockId && r.source.spanOrdinal === req.source.spanOrdinal && normalizePhrase(r.source.text) === text,
          );
          if (linked) return ok({ reminder: linked, existing: true });
          const { source, ...input } = req;
          const dto = { ...toReminder({ foldPreference: 'earlier', allowPast: false, ...input, blockId: source.blockId }, uid(), 1), source: sourceOf(source as SuggestionSourceType) };
          reminderData.byNote.set(req.noteId, [...(reminderData.byNote.get(req.noteId) ?? []), dto]);
          return ok({ reminder: dto, existing: false });
        }),
      updateFromSource: (req) =>
        handle<ReminderDtoType>('reminder:updateFromSource', req, () => {
          const old = allReminders().find((r) => r.id === req.reminderId);
          if (!old) return fail('NOT_FOUND', 'This reminder no longer exists');
          if (req.action === 'keep') {
            const kept = { ...old, source: old.source ? { ...old.source, state: 'detached' as const } : null };
            replaceReminder(kept);
            return ok(kept);
          }
          if (old.revision !== req.expectedRevision) return fail('CONFLICT', 'This reminder changed elsewhere. Reopen it to edit.', { currentRevision: old.revision });
          const { source, action: _a, ...input } = req;
          const dto = { ...toReminder({ foldPreference: 'earlier', allowPast: false, ...input, noteId: old.noteId, blockId: source.blockId }, old.id, old.revision + 1), source: sourceOf(source as SuggestionSourceType) };
          replaceReminder(dto);
          return ok(dto);
        }),
    },
    suggestion: {
      dismiss: (req) =>
        handle('suggestion:dismiss', req, () => {
          const dismissal: DismissalDtoType = { blockId: req.blockId, text: normalizePhrase(req.text), spanOrdinal: req.spanOrdinal, referenceDate: req.referenceDate, createdAt: clock };
          const list = reminderData.dismissals.get(req.noteId) ?? [];
          const same = list.find((d) => d.blockId === dismissal.blockId && d.text === dismissal.text && d.spanOrdinal === dismissal.spanOrdinal && d.referenceDate === dismissal.referenceDate);
          if (!same) reminderData.dismissals.set(req.noteId, [dismissal, ...list]);
          return ok({ dismissal: same ?? dismissal });
        }),
      listDismissed: (req) =>
        handle('suggestion:listDismissed', req, () => {
          const { asOf, systemZone, defaultZone } = reminderData.zones;
          return ok({ asOf, systemZone, defaultZone, dismissals: reminderData.dismissals.get(req.noteId) ?? [] });
        }),
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
    backup: {
      create: () => handle('backup:create', {}, () => ok({ canceled: true as const })),
      prepareRestore: () => handle('backup:prepareRestore', {}, () => ok({ canceled: true as const })),
      restore: () => handle('backup:restore', {}, () => ok({ restarting: true as const })),
      status: () => handle('backup:status', {}, () => ok(portabilityData.status)),
      setAuto: (req) => handle('backup:setAuto', req, () => ok((portabilityData.status = { ...portabilityData.status, auto: { ...portabilityData.status.auto, ...req } }))),
      chooseAutoFolder: () => handle('backup:chooseAutoFolder', {}, () => ok(portabilityData.status)),
      deleteRollback: () => handle('backup:deleteRollback', {}, () => ok((portabilityData.status = { ...portabilityData.status, rollbackCopies: [] }))),
    },
    export: {
      markdown: (req) => handle('export:markdown', req, () => ok({ canceled: true as const })),
      noteDocument: (req) => handle('export:noteDocument', req, () => ok({ canceled: false as const, file: `/exports/note.${req.format}` })),
      portable: () => handle('export:portable', {}, () => ok({ canceled: true as const })),
    },
    import: { portable: () => handle('import:portable', {}, () => ok({ canceled: true as const })) },
    shortcut: {
      getGlobal: () => handle('shortcut:getGlobal', {}, () => ok(portabilityData.shortcut)),
      setGlobal: (req) => handle('shortcut:setGlobal', req, () => ok((portabilityData.shortcut = { ...portabilityData.shortcut, ...req, registered: req.enabled }))),
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
    /** Arranges a document directly (no tree:changed). */
    addDocument,
    data: { threads, documents, documentPicks, documentHandoffs, locks: lockData, reminders: reminderData, windows: windowData, portability: portabilityData, setDropped: (d: typeof dropped) => (dropped = d), setWindowState: (w: WindowGetStateResponseType) => (windowState = w), setCapabilities: (c: CapabilitiesType) => (capabilities = c), floating, settings, projects, folders, notes, sessions, drafts, versions, imports, shellCalls, handoffs, noteTags, getSession: () => session, setSession: (s: TabSessionType) => (session = s) },
  };
}

export type FakeBridge = ReturnType<typeof createFakeBridge>;
