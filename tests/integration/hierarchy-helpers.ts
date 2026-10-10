import path from 'node:path';
import { expect } from 'vitest';
import { APP_VERSION } from '../../src/shared/app-identity';
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
import type { KdfParams } from '../../src/main/locks/note-crypto';
import type { PinKdf } from '../../src/main/locks/pin-verifier';
import type { StickyLockStateType } from '../../src/shared/contracts/locks';
import { runWorkbookTask } from '../../src/main/documents/spreadsheet/workbook-convert';
import { fixedClock, openFresh, randomIds, type TestDb } from './helpers';

/** The real PDF text worker, run from its source (Node strips the types), with the package's character maps. */
export const TEST_PDF_TEXT = {
  workerFile: path.resolve('src/main/documents/text/pdf-text.ts'),
  cMapDir: path.resolve('node_modules/pdfjs-dist/cmaps'),
};

/** scrypt at its smallest accepted cost, so tests that lock notes stay fast (the app uses DEFAULT_KDF). */
export const TEST_KDF: KdfParams = { name: 'scrypt', N: 1024, r: 8, p: 1 };
export const TEST_PIN_KDF: PinKdf = { name: 'scrypt', N: 1024, r: 8, p: 1 };

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
    /** Locked notes: the OS key, its protection and power events (cheap scrypt parameters unless given). */
    locks?: MainServicesDeps['locks'];
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
  /** Lock states main sent to sticky windows (D-172). */
  const stickyLockEvents: Array<{ webContentsId: number; state: StickyLockStateType }> = [];
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
  /** Pages handed to the printer: "pdf" makes a small fake PDF, "print" answers `printResult` (D-163). */
  const printed: Array<{ op: 'pdf' | 'print'; html: string }> = [];
  const printResult = { printed: true };
  const paths = resolveDataPaths(t.dir);
  const dataDir = path.join(t.dir, 'data');
  const services = createMainServices({
    pdfText: TEST_PDF_TEXT,
    // The workbook worker's body, run in the test process (the built worker is checked after the build, D-134).
    workbooks: runWorkbookTask,
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
    appVersion: APP_VERSION,
    latestSchema: LATEST,
    restart: () => {
      restarts.count += 1;
    },
    restoreOutcome: opts.restoreOutcome ?? null,
    printer: {
      toPdf: async (html) => {
        printed.push({ op: 'pdf', html });
        return new TextEncoder().encode('%PDF-1.7 fake');
      },
      print: async (html) => {
        printed.push({ op: 'print', html });
        return printResult.printed;
      },
    },
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
    sendStickyLock: (webContentsId, state) => stickyLockEvents.push({ webContentsId, state }),
    zones,
    onReminderChanged: (e) => reminderEvents.push(e),
    onRemindersWritten: () => {
      reminderWrites.count += 1;
      reminderWrites.onWrite?.();
    },
    testFaults: opts.testFaults,
    locks: { kdf: TEST_KDF, pinKdf: TEST_PIN_KDF, ...opts.locks },
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
    stickyLockEvents,
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
    printed,
    printResult,
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
