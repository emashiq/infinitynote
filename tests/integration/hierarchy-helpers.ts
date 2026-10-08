import path from 'node:path';
import { expect } from 'vitest';
import type { TreeChangedEventType } from '../../src/shared/contracts/hierarchy';
import type { NoteLeaseEventType, NoteRevisionEventType } from '../../src/shared/contracts/notes';
import { HierarchyRepo } from '../../src/main/db/repositories/hierarchy-repo';
import { createMainServices, type MainServicesDeps } from '../../src/main/main-services';
import type { OpenFilesRequest } from '../../src/main/services/dialog-adapter';
import type { LeaseHolder } from '../../src/main/services/lease-manager';
import { memoryLogger } from '../../src/main/services/logger';
import { fixedClock, openFresh, randomIds } from './helpers';

/**
 * The production service graph (createMainServices) over a fresh temp database with an injectable clock, a
 * queued fake file dialog and recorded events.
 */
export async function setupServices(opts: { testFaults?: MainServicesDeps['testFaults']; onTreeChanged?: (e: TreeChangedEventType) => void } = {}) {
  const t = await openFresh();
  const clock = fixedClock(1_800_000_000_000);
  const ids = randomIds();
  const logger = memoryLogger();
  const events: TreeChangedEventType[] = [];
  const settingsEvents: unknown[] = [];
  const revisions: NoteRevisionEventType[] = [];
  const leaseEvents: NoteLeaseEventType[] = [];
  const releaseRequests: Array<{ holder: LeaseHolder; noteId: string }> = [];
  /** Each dialog call takes the next entry; null or an empty queue means the user canceled. */
  const dialogQueue: Array<string[] | null> = [];
  const dialogCalls: OpenFilesRequest[] = [];
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
    },
    onSettingsChanged: (p) => settingsEvents.push(p),
    onTreeChanged: (e) => {
      events.push(e);
      opts.onTreeChanged?.(e);
    },
    onNoteRevision: (e) => revisions.push(e),
    onLeaseChanged: (e) => leaseEvents.push(e),
    requestLeaseRelease: (holder, noteId) => releaseRequests.push({ holder, noteId }),
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
    leaseEvents,
    releaseRequests,
    dialogQueue,
    dialogCalls,
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

/** Mulberry32 seeded PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
