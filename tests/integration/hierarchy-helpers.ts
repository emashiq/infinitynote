import { expect } from 'vitest';
import type { TreeChangedEventType } from '../../src/shared/contracts/hierarchy';
import { SettingsRepo } from '../../src/main/db/repositories/settings-repo';
import { HierarchyService } from '../../src/main/services/hierarchy-service';
import { HomeService } from '../../src/main/services/home-service';
import { LeaseManager } from '../../src/main/services/lease-manager';
import { memoryLogger } from '../../src/main/services/logger';
import { NoteReader } from '../../src/main/services/note-reader';
import { NoteWriter } from '../../src/main/services/note-writer';
import { PaletteService } from '../../src/main/services/palette-service';
import { SessionService } from '../../src/main/services/session-service';
import { SettingsService } from '../../src/main/services/settings-service';
import { TrashService } from '../../src/main/services/trash-service';
import { fixedClock, openFresh, seqIds } from './helpers';

/** Real services over a fresh temp database with an injectable clock. */
export async function setupServices() {
  const t = await openFresh();
  const clock = fixedClock(1_800_000_000_000);
  const ids = seqIds();
  const logger = memoryLogger();
  const events: TreeChangedEventType[] = [];
  const onChange = (e: TreeChangedEventType) => events.push(e);
  const hierarchy = new HierarchyService({ db: t.db, clock, ids, logger, onChange });
  const trash = new TrashService({ db: t.db, clock, ids, logger, onChange });
  const settingsEvents: unknown[] = [];
  const settings = new SettingsService({ repo: new SettingsRepo(t.db), clock, logger, emit: (p) => settingsEvents.push(p) });
  const home = new HomeService(t.db);
  const sessions = new SessionService(t.db, settings, clock);
  const palette = new PaletteService(t.db);
  const reader = new NoteReader(t.db);
  const leases = new LeaseManager({ ids, clock, requestRelease: () => {}, emit: () => {} });
  const writer = new NoteWriter({ db: t.db, leases, clock, ids, emit: () => {} });

  const tick = (ms = 10) => clock.advance(ms);
  const check = () => expect(hierarchy.repo.findInvariantViolation()).toBeNull();

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
    t,
    clock,
    ids,
    logger,
    events,
    hierarchy,
    trash,
    settings,
    settingsEvents,
    home,
    sessions,
    palette,
    reader,
    leases,
    writer,
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
