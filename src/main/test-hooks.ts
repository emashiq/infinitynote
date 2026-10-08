import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { NoteRevisionEventType } from '../shared/contracts/notes';
import { textToDoc } from '../shared/text/textarea-doc';
import type { Db } from './db/driver';
import type { Desktop } from './desktop';
import { NotesRepo } from './db/repositories/notes-repo';
import type { MainServices } from './main-services';
import { AppError } from './services/app-error';
import type { CloseChoice, CloseDialogOptions } from './services/close-dialog';
import type { DialogAdapter } from './services/dialog-adapter';
import type { FlushOutcome } from './services/flush-coordinator';
import type { Clock } from './services/clock';
import type { SaveFaults } from './services/note-writer';
import type { ShellAdapter } from './services/shell-adapter';
import type { DisplayInfo } from './windows/display-clamp';
import { createFakeDisplayProvider, type DisplayProvider, type FakeDisplays } from './windows/display-provider';
import type { NativeWindowInfo, WindowInspector } from './windows/electron-inspector';
import type { StickyLayoutEntry } from './windows/sticky-manager';
import type { WindowRegistry } from './windows/window-registry';

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
  /** Each main-window close question takes the next answer; an empty queue means Cancel. No real dialog is shown. */
  closeChoices: CloseChoice[];
  /** The close questions that would have been shown. */
  closeDialogs: CloseDialogOptions[];
  /** App-computed sticky placements (creation and display re-clamps). */
  stickyLog: StickyLayoutEntry[];
  windows(): { main: MainWindowInfo | null; stickies: StickyWindowInfo[] };
  listenerCounts(): Record<string, number>;
  /** Present when INFINITY_NOTES_TEST_DISPLAYS was given: replaces the connected displays. */
  displays: { set(displays: DisplayInfo[], primaryId: number): void } | null;
  tray: { readonly present: boolean; items(): string[]; click(label: string): void } | null;
}

export interface MainWindowInfo {
  webContentsId: number;
  visible: boolean;
}

export interface StickyWindowInfo extends Partial<NativeWindowInfo> {
  noteId: string;
  webContentsId: number;
  collapsed: boolean;
  activation: number;
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
  /** The fake display set from INFINITY_NOTES_TEST_DISPLAYS, or null to use the real screen. */
  displays: (DisplayProvider & { set(displays: DisplayInfo[], primaryId: number): void }) | null;
  /** Exposes the windows side once it exists. */
  attachDesktop(deps: { desktop: Desktop; registry: WindowRegistry; services: MainServices | null; inspector: WindowInspector }): void;
}

const Rect = z.strictObject({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() });
const TestDisplays = z.strictObject({
  displays: z.array(z.strictObject({ id: z.number().int(), bounds: Rect, workArea: Rect })).min(1),
  primaryId: z.number().int(),
});

/** Parses INFINITY_NOTES_TEST_DISPLAYS (JSON `{displays:[{id, bounds, workArea}], primaryId}`); invalid input is ignored. */
export function parseTestDisplays(raw: string | undefined): FakeDisplays | null {
  if (!raw) return null;
  try {
    const parsed = TestDisplays.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Test hooks exist only in unpackaged builds started with INFINITY_NOTES_E2E=1. */
export function testHooksEnabled(isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return !isPackaged && env.INFINITY_NOTES_E2E === '1';
}

export function installTestHooks(env: NodeJS.ProcessEnv = process.env): TestHooks {
  const fakeDisplays = parseTestDisplays(env.INFINITY_NOTES_TEST_DISPLAYS);
  const displays = fakeDisplays ? createFakeDisplayProvider(fakeDisplays) : null;
  const state: TestState = {
    blockedRequests: [],
    shellCalls: [],
    dialogQueue: [],
    failSaves: 0,
    importDelayMs: 0,
    flushLog: [],
    fakeView: null,
    closeChoices: [],
    closeDialogs: [],
    stickyLog: [],
    windows: () => ({ main: null, stickies: [] }),
    listenerCounts: () => ({}),
    displays: displays ? { set: (list, primaryId) => displays.set(list, primaryId) } : null,
    tray: null,
  };
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
      showCloseChoice: async (_parent, options) => {
        state.closeDialogs.push(options);
        return state.closeChoices.shift() ?? { choice: 'cancel', remember: false };
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
    displays,
    attachDesktop({ desktop, registry, services, inspector }) {
      state.windows = () => {
        const mainId = desktop.mainWindow.webContentsId();
        const main = mainId === null ? null : { webContentsId: mainId, visible: inspector.window(mainId)?.visible ?? false };
        const stickies = (desktop.stickies?.list() ?? []).map(({ noteId, handle, activation }) => ({
          noteId,
          webContentsId: handle.webContentsId,
          ...inspector.window(handle.webContentsId),
          collapsed: services?.stickies.state(noteId).collapsed ?? false,
          activation,
        }));
        return { main, stickies };
      };
      state.listenerCounts = () => ({
        ...inspector.counts(),
        'displays:changed': desktop.displays.listenerCount(),
        registry: registry.size(),
      });
      state.tray = {
        get present() {
          return desktop.tray.isPresent();
        },
        items: () => desktop.tray.items.map((i) => i.label),
        click: (label) => desktop.tray.click(label),
      };
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
