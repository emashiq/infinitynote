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
import { createFakeClock, type Clock, type FakeClock } from './services/clock';
import { createFakeNotificationAdapter, type FakeNotificationAdapter, type FakeNotifyMode, type ShownNotification } from './services/notification-adapter';
import { createFakePowerEvents, type PowerEvent } from './services/power-events';
import type { ReminderScheduler } from './services/reminder-scheduler';
import { createFixedZoneProvider, type SystemZoneProvider } from './services/system-zone';
import type { SaveFaults } from './services/note-writer';
import type { AutostartAdapter } from './services/autostart';
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
  shellCalls: Array<{ op: 'openPath' | 'showItemInFolder'; path: string } | { op: 'openExternal'; url: string }>;
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
  /** The caption-button overlay last applied to the main window (D-097). */
  titleBarOverlay: { color?: string; symbolColor?: string; height?: number } | null;
  /** App-computed sticky placements (creation and display re-clamps). */
  stickyLog: StickyLayoutEntry[];
  /** Reads the database, so it resolves on a fresh macrotask (onFreshTask). */
  windows(): Promise<{ main: MainWindowInfo | null; stickies: StickyWindowInfo[] }>;
  listenerCounts(): Record<string, number>;
  /** Present when INFINITY_NOTES_TEST_DISPLAYS was given: replaces the connected displays. */
  displays: { set(displays: DisplayInfo[], primaryId: number): void } | null;
  tray: { readonly present: boolean; items(): string[]; click(label: string): void } | null;
  /** The frozen reminder clock (INFINITY_NOTES_TEST_CLOCK); each move resolves after the tick it triggered. */
  clock: { now(): number; set(iso: string): Promise<void>; advance(ms: number): Promise<void>; jump(ms: number): Promise<void> } | null;
  /** The fake notification adapter (unless INFINITY_NOTES_TEST_NOTIFY=real); click and close act like the OS. */
  notifications: { mode: FakeNotifyMode; shown(): ShownNotification[]; click(id: number): Promise<void>; close(id: number): Promise<void> } | null;
  /** The computer zone as reminders see it (INFINITY_NOTES_TEST_ZONE); a change wakes the scheduler. */
  zone: { set(zone: string | null): Promise<void> } | null;
  power: { emit(event: PowerEvent): Promise<void> };
  scheduler: { timer(): { armed: boolean; delayMs: number | null }; ticks(): number; idle(): Promise<void> } | null;
  /** The reminder widget window as main sees it (a fresh task), or null while it is hidden. */
  widget(): Promise<(Partial<NativeWindowInfo> & { webContentsId: number }) | null>;
  /** The fake login-item adapter of unpackaged runs: its state and every change asked of it (D-082). */
  autostart: { enabled: boolean; calls: boolean[] };
  /** Raw reminder, occurrence, delivery, source and dismissal rows (a fresh task, F04-A2). */
  reminders(): Promise<ReminderRows>;
}

export interface ReminderRows {
  reminders: unknown[];
  occurrences: unknown[];
  deliveries: unknown[];
  sources: unknown[];
  dismissals: unknown[];
}

/** What the reminder subsystem uses instead of the real clock, zone, notifications and power events under test hooks. */
export interface ReminderSeams {
  clock: FakeClock | null;
  zones: (SystemZoneProvider & { set(zone: string | null): void }) | null;
  notifications: FakeNotificationAdapter | null;
  power: ReturnType<typeof createFakePowerEvents>;
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
  reminderSeams: ReminderSeams;
  /** Never the real login items or autostart folder in tests (D-082). */
  autostart: AutostartAdapter;
  /** Exposes the scheduler once it exists (storage is up). */
  attachReminders(deps: { scheduler: ReminderScheduler; db: Db }): void;
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

/**
 * Runs a hook's database work on a fresh macrotask (F04-A2, D-084). A Playwright evaluate can run while the main
 * thread is paused inside a better-sqlite3 statement (an inspector interrupt); SQL from that nested call fails with
 * "This database connection is busy". Deferring to setImmediate runs it only after the interrupted task finished.
 */
export function onFreshTask<T>(fn: () => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) =>
    setImmediate(() => {
      try {
        resolve(fn());
      } catch (err) {
        reject(err);
      }
    }),
  );
}

/** Reads the reminder seams from the environment (D-084); invalid values are ignored. */
export function createReminderSeams(env: NodeJS.ProcessEnv): ReminderSeams {
  const start = env.INFINITY_NOTES_TEST_CLOCK ? Date.parse(env.INFINITY_NOTES_TEST_CLOCK) : Number.NaN;
  const clock = Number.isFinite(start) ? createFakeClock(start) : null;
  return {
    clock,
    zones: env.INFINITY_NOTES_TEST_ZONE ? createFixedZoneProvider(env.INFINITY_NOTES_TEST_ZONE) : null,
    notifications: env.INFINITY_NOTES_TEST_NOTIFY === 'real' ? null : createFakeNotificationAdapter(clock ?? { now: () => Date.now() }),
    power: createFakePowerEvents(),
  };
}

/** Test hooks exist only in unpackaged builds started with INFINITY_NOTES_E2E=1. */
export function testHooksEnabled(isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return !isPackaged && env.INFINITY_NOTES_E2E === '1';
}

export function installTestHooks(env: NodeJS.ProcessEnv = process.env): TestHooks {
  const fakeDisplays = parseTestDisplays(env.INFINITY_NOTES_TEST_DISPLAYS);
  const displays = fakeDisplays ? createFakeDisplayProvider(fakeDisplays) : null;
  const reminderSeams = createReminderSeams(env);
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
    titleBarOverlay: null,
    stickyLog: [],
    windows: async () => ({ main: null, stickies: [] }),
    listenerCounts: () => ({}),
    displays: displays ? { set: (list, primaryId) => displays.set(list, primaryId) } : null,
    tray: null,
    clock: null,
    notifications: null,
    zone: null,
    power: { emit: async (event) => reminderSeams.power.emit(event) },
    scheduler: null,
    widget: async () => null,
    autostart: { enabled: false, calls: [] },
    reminders: async () => ({ reminders: [], occurrences: [], deliveries: [], sources: [], dismissals: [] }),
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
      showItemInFolder: (p) => {
        state.shellCalls.push({ op: 'showItemInFolder', path: p });
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
      state.windows = () =>
        onFreshTask(() => {
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
        });
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
      state.widget = () =>
        onFreshTask(() => {
          const handle = desktop.widget?.handle();
          return handle ? { webContentsId: handle.webContentsId, ...inspector.window(handle.webContentsId) } : null;
        });
    },
    reminderSeams,
    autostart: {
      isEnabled: () => state.autostart.enabled,
      setEnabled: (enabled) => {
        state.autostart.calls.push(enabled);
        state.autostart.enabled = enabled;
      },
    },
    attachReminders({ scheduler, db }) {
      Object.assign(state, reminderTestState(reminderSeams, scheduler, db));
    },
  };
}

/** The reminder hooks; every one that ticks the scheduler or reads the database resolves on a fresh task. */
function reminderTestState(seams: ReminderSeams, scheduler: ReminderScheduler, db: Db): Pick<TestState, 'clock' | 'notifications' | 'zone' | 'power' | 'scheduler' | 'reminders'> {
  const tick = (change: () => void) =>
    onFreshTask(async () => {
      change();
      scheduler.wake('timer');
      await scheduler.idle();
    });
  const after = (action: () => void) =>
    onFreshTask(async () => {
      action();
      await scheduler.idle();
    });
  const { clock, zones, notifications, power } = seams;
  return {
    clock: clock && {
      now: () => clock.now(),
      set: (iso) => tick(() => clock.set(Date.parse(iso))),
      advance: (ms) => tick(() => clock.advance(ms)),
      jump: (ms) => tick(() => clock.jump(ms)),
    },
    notifications: notifications && {
      get mode() {
        return notifications.mode;
      },
      set mode(mode: FakeNotifyMode) {
        notifications.mode = mode;
      },
      shown: () => notifications.shown(),
      click: (id) => after(() => notifications.click(id)),
      close: (id) => after(() => notifications.close(id)),
    },
    zone: zones && { set: (zone) => tick(() => zones.set(zone)) },
    power: { emit: (event) => after(() => power.emit(event)) },
    scheduler: { timer: () => scheduler.timerState(), ticks: () => scheduler.ticks(), idle: () => scheduler.idle() },
    reminders: () =>
      onFreshTask(() => ({
        reminders: db.prepare('SELECT * FROM reminders ORDER BY created_at, id').all(),
        occurrences: db.prepare('SELECT * FROM occurrences ORDER BY due_at_utc, id').all(),
        deliveries: db.prepare('SELECT * FROM alert_deliveries ORDER BY claimed_at, alert_sequence, id').all(),
        sources: db.prepare('SELECT * FROM reminder_sources ORDER BY created_at, reminder_id').all(),
        dismissals: db.prepare('SELECT * FROM suggestion_dismissals ORDER BY created_at, dedupe_key').all(),
      })),
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
