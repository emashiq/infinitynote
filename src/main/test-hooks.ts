import { randomUUID } from 'node:crypto';
import type { NoteRevisionEventType } from '../shared/contracts/notes';
import { textToDoc } from '../shared/text/textarea-doc';
import type { Db } from './db/driver';
import { NotesRepo } from './db/repositories/notes-repo';
import type { MainServices } from './main-services';
import { AppError } from './services/app-error';
import type { DialogAdapter } from './services/dialog-adapter';
import type { FlushOutcome } from './services/flush-coordinator';
import type { Clock } from './services/clock';
import type { SaveFaults } from './services/note-writer';
import type { ShellAdapter } from './services/shell-adapter';

/** A second editing view living in main, so E2E can exercise leases and conflicts without a second window. */
export const FAKE_VIEW_ID = 'fa4e0000-0000-4000-8000-000000000001';
export const FAKE_WEB_CONTENTS_ID = -1000;

export type FakeSaveResult = { ok: true; revision: number } | { ok: false; code: string; draftId?: string };

export interface FakeView {
  releaseBehavior: 'release' | 'ignore';
  acquire(noteId: string): boolean;
  release(noteId: string): boolean;
  take(noteId: string): Promise<boolean>;
  save(noteId: string, text: string): FakeSaveResult;
  /** Bumps the revision like an external writer would, without a lease (stale-conflict E2E only). */
  forceWrite(noteId: string, text: string, opts: { emit: boolean }): number;
}

/** What E2E specs read and set through `globalThis.__infinityTest` (app.evaluate). */
export interface TestState {
  blockedRequests: string[];
  shellCalls: Array<{ op: 'openPath'; path: string } | { op: 'openExternal'; url: string }>;
  /** Each file-dialog call takes the next entry; an empty queue means the user canceled. */
  dialogQueue: string[][];
  /** The next N `note:save` calls fail with INTERNAL. */
  failSaves: number;
  /** Delay before each attachment import starts. */
  importDelayMs: number;
  flushLog: FlushOutcome[];
  fakeView: FakeView | null;
}

declare global {
  var __infinityTest: TestState | undefined;
}

export interface TestHooks {
  state: TestState;
  shell: ShellAdapter;
  dialog: DialogAdapter;
  faults: { save: SaveFaults; beforeImport: () => Promise<void> };
  /** Installs the fake view once the services exist. */
  attachServices(deps: { services: MainServices; db: Db; clock: Clock; emitRevision: (e: NoteRevisionEventType) => void }): void;
  /** True when a lease holder is the fake view; it answers release requests itself. */
  ownsWebContents(webContentsId: number): boolean;
  onReleaseRequest(noteId: string): void;
}

/** Test hooks exist only in unpackaged builds started with INFINITY_NOTES_E2E=1. */
export function testHooksEnabled(isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return !isPackaged && env.INFINITY_NOTES_E2E === '1';
}

export function installTestHooks(): TestHooks {
  const state: TestState = { blockedRequests: [], shellCalls: [], dialogQueue: [], failSaves: 0, importDelayMs: 0, flushLog: [], fakeView: null };
  globalThis.__infinityTest = state;
  return {
    state,
    shell: {
      openPath: async (p) => {
        state.shellCalls.push({ op: 'openPath', path: p });
        return '';
      },
      openExternal: async (url) => {
        state.shellCalls.push({ op: 'openExternal', url });
      },
    },
    dialog: {
      showOpenFiles: async () => {
        const next = state.dialogQueue.shift();
        return next && next.length > 0 ? next : null;
      },
    },
    faults: {
      save: {
        beforeSave: () => {
          if (state.failSaves <= 0) return;
          state.failSaves -= 1;
          throw new AppError('INTERNAL', 'Could not save the note');
        },
      },
      beforeImport: () => new Promise((resolve) => setTimeout(resolve, state.importDelayMs)),
    },
    attachServices(deps) {
      state.fakeView = createFakeView(deps);
    },
    ownsWebContents: (webContentsId) => webContentsId === FAKE_WEB_CONTENTS_ID,
    onReleaseRequest(noteId) {
      if (state.fakeView?.releaseBehavior === 'release') state.fakeView.release(noteId);
    },
  };
}

function createFakeView(deps: { services: MainServices; db: Db; clock: Clock; emitRevision: (e: NoteRevisionEventType) => void }): FakeView {
  const { leases, writer, content } = deps.services;
  const notes = new NotesRepo(deps.db);
  const tokens = new Map<string, string>();
  const row = (noteId: string) => {
    const r = notes.getContentRow(noteId);
    if (!r) throw new Error(`fake view: no note ${noteId}`);
    return r;
  };
  const body = (noteId: string, text: string) => (row(noteId).format === 'rich' ? textToDoc(text) : text);
  return {
    releaseBehavior: 'release',
    acquire(noteId) {
      const r = leases.acquire(noteId, FAKE_VIEW_ID, FAKE_WEB_CONTENTS_ID);
      if (r.granted) tokens.set(noteId, r.leaseToken);
      return r.granted;
    },
    release(noteId) {
      const token = tokens.get(noteId);
      tokens.delete(noteId);
      return token ? leases.release(noteId, FAKE_VIEW_ID, token, FAKE_WEB_CONTENTS_ID).released : false;
    },
    async take(noteId) {
      try {
        tokens.set(noteId, (await leases.take(noteId, FAKE_VIEW_ID, FAKE_WEB_CONTENTS_ID)).leaseToken);
        return true;
      } catch {
        return false;
      }
    },
    save(noteId, text) {
      const current = row(noteId);
      try {
        const ack = writer.save(
          {
            noteId,
            viewId: FAKE_VIEW_ID,
            leaseToken: tokens.get(noteId) ?? FAKE_VIEW_ID,
            baseRevision: current.revision,
            requestId: randomUUID(),
            format: current.format,
            content: body(noteId, text),
          },
          { webContentsId: FAKE_WEB_CONTENTS_ID },
        );
        return { ok: true, revision: ack.revision };
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        const details = err.details as { draftId?: string } | undefined;
        return { ok: false, code: err.code, draftId: details?.draftId };
      }
    },
    forceWrite(noteId, text, opts) {
      const current = row(noteId);
      const { revision } = deps.db.transaction(
        () =>
          content.write({
            noteId,
            format: current.format,
            content: body(noteId, text),
            title: null,
            expectedRevision: current.revision,
            now: deps.clock.now(),
          }),
        'immediate',
      );
      if (opts.emit) deps.emitRevision({ noteId, revision, sourceViewId: FAKE_VIEW_ID });
      return revision;
    },
  };
}
