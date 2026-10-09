import path from 'node:path';
import { expect } from 'vitest';
import type { TreeChangedEventType } from '../../src/shared/contracts/hierarchy';
import type { NoteRevisionEventType } from '../../src/shared/contracts/notes';
import type { ReminderChangedEventType } from '../../src/shared/contracts/reminders';
import { resolveDataPaths } from '../../src/main/app-paths';
import { HierarchyRepo } from '../../src/main/db/repositories/hierarchy-repo';
import { createMainServices, type MainServicesDeps } from '../../src/main/main-services';
import type { OpenFilesRequest, PathRequest } from '../../src/main/services/dialog-adapter';
import type { FakeClock } from '../../src/main/services/clock';
import { memoryLogger } from '../../src/main/services/logger';
import { createFixedZoneProvider } from '../../src/main/services/system-zone';
import { LATEST } from '../../src/main/db/migrations';
import { fixedClock, openFresh, randomIds, type TestDb } from './helpers';

/**
 * The production service graph (createMainServices) over a fresh temp database with an injectable clock, a
 * queued fake file dialog and recorded events.
 */
export async function setupServices(
  opts: {
    testFaults?: MainServicesDeps['testFaults'];
    onTreeChanged?: (e: TreeChangedEventType) => void;
    now?: number;
    zone?: string | null;
    /** Replaces the default clock (the reminder tests move wall and monotonic time separately). */
    clock?: FakeClock;
    /** An already open database (a restart: see reopen); a fresh one by default. */
    testDb?: TestDb;
    /** What a restore applied at this "start" did (backup tests). */
    restoreOutcome?: MainServicesDeps['restoreOutcome'];
  } = {},
) {
  const t = opts.testDb ?? (await openFresh());
  const clock = opts.clock ?? fixedClock(opts.now ?? 1_800_000_000_000);
  /** The computer's zone as the reminder services see it (D-084 seam). */
  const zones = createFixedZoneProvider(opts.zone === undefined ? 'Asia/Dhaka' : opts.zone);
  const reminderEvents: ReminderChangedEventType[] = [];
  /** Counts committed reminder writes; `onWrite` lets a test wake its scheduler like main does. */
  const reminderWrites: { count: number; onWrite?: () => void } = { count: 0 };
  const ids = randomIds();
  const logger = memoryLogger();
  const events: TreeChangedEventType[] = [];
  const settingsEvents: unknown[] = [];
  const revisions: NoteRevisionEventType[] = [];
  /** Live-sync events main sent, per window (D-103). */
  const collabEvents: Array<{ webContentsId: number; channel: string; payload: unknown }> = [];
  /** Each dialog call takes the next entry; null or an empty queue means the user canceled. */
  const dialogQueue: Array<string[] | null> = [];
  const dialogCalls: OpenFilesRequest[] = [];
  /** Save, open-file and folder dialogs take the next entry; null or an empty queue means the user canceled. */
  const pathQueue: Array<string | null> = [];
  const pathDialogs: Array<PathRequest & { kind: 'save' | 'open' | 'folder' }> = [];
  const pathDialog = (kind: 'save' | 'open' | 'folder') => async (req: PathRequest) => {
    pathDialogs.push({ ...req, kind });
    return pathQueue.shift() ?? null;
  };
  const restarts = { count: 0 };
  /** What the services handed to the OS shell; openPath answers with `shellError` (empty means success). */
  const shellCalls: Array<{ op: string; target: string }> = [];
  const shellResult = { error: '' };
  const paths = resolveDataPaths(t.dir);
  const dataDir = path.join(t.dir, 'data');
  const services = createMainServices({
    db: t.db,
    clock,
    ids,
    logger,
    dataDir,
    dialog: {
      showOpenFiles: async (req) => {
        dialogCalls.push(req);
        return dialogQueue.shift() ?? null;
      },
      showSaveFile: pathDialog('save'),
      showOpenFile: pathDialog('open'),
      showOpenFolder: pathDialog('folder'),
    },
    restorePaths: paths,
    appVersion: '0.1.0',
    latestSchema: LATEST,
    restart: () => {
      restarts.count += 1;
    },
    restoreOutcome: opts.restoreOutcome ?? null,
    shell: {
      openPath: async (p) => {
        shellCalls.push({ op: 'openPath', target: p });
        return shellResult.error;
      },
      openExternal: async (url) => {
        shellCalls.push({ op: 'openExternal', target: url });
      },
      showItemInFolder: (p) => {
        shellCalls.push({ op: 'showItemInFolder', target: p });
      },
    },
    onSettingsChanged: (p) => settingsEvents.push(p),
    onTreeChanged: (e) => {
      events.push(e);
      opts.onTreeChanged?.(e);
    },
    onNoteRevision: (e) => revisions.push(e),
    sendCollab: (webContentsId, channel, payload) => collabEvents.push({ webContentsId, channel, payload }),
    zones,
    onReminderChanged: (e) => reminderEvents.push(e),
    onRemindersWritten: () => {
      reminderWrites.count += 1;
      reminderWrites.onWrite?.();
    },
    testFaults: opts.testFaults,
  });
  const { hierarchy } = services;
  const repo = new HierarchyRepo(t.db);

  const tick = (ms = 10) => clock.advance(ms);
  const check = () => expect(repo.findInvariantViolation()).toBeNull();

  const project = (name: string) => {
    tick();
    const r = hierarchy.createProject(name).project;
    check();
    return r;
  };
  const folder = (projectId: string | null, parentId: string | null, name: string) => {
    tick();
    const r = hierarchy.createFolder({ projectId, parentId }, name).folder;
    check();
    return r;
  };
  const note = (projectId: string | null, folderId: string | null, title = '', sticky = false) => {
    tick();
    const r = hierarchy.createNote({ projectId, folderId }, sticky, title).note;
    check();
    return r;
  };
  const row = <T>(sql: string, ...args: unknown[]): T | undefined => t.db.prepare<unknown[], T>(sql).get(...args);
  const rows = <T>(sql: string, ...args: unknown[]): T[] => t.db.prepare<unknown[], T>(sql).all(...args);

  return {
    ...services,
    services,
    t,
    clock,
    ids,
    logger,
    events,
    settingsEvents,
    revisions,
    collabEvents,
    zones,
    reminderEvents,
    reminderWrites,
    dialogQueue,
    dialogCalls,
    pathQueue,
    pathDialogs,
    restarts,
    paths,
    shellCalls,
    shellResult,
    dataDir,
    repo,
    tick,
    check,
    project,
    folder,
    note,
    row,
    rows,
  };
}

export type Services = Awaited<ReturnType<typeof setupServices>>;

/** Runs fn and returns the thrown AppError-like shape, or fails the test. */
export function thrown(fn: () => unknown): { code: string; message: string; details?: unknown } {
  try {
    fn();
  } catch (err) {
    const e = err as { code?: string; message: string; details?: unknown };
    return { code: e.code ?? 'UNKNOWN', message: e.message, details: e.details };
  }
  throw new Error('expected the call to throw');
}
