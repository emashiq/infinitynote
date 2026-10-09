import type { HexColor } from '../../shared/color';
import type { CapabilitiesType } from '../../shared/contracts/app';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { Result } from '../../shared/contracts/envelope';
import type { NoteColorType } from '../../shared/contracts/hierarchy';
import type { StickyStateType } from '../../shared/contracts/stickies';
import { displayTitle } from '../../shared/names';
import { NoteController, textIsSafe, type FlushResult } from '../notes/note-controller';
import { browserHideEvents, createCoreServices, type CoreServices } from '../state/core-services';
import { WINDOW_KEPT_NOTICE, restoreNotice, trashedDraftNotice, unsavedFlushNotice } from '../state/notice-store';
import { createStore, failOutcome, okOutcome, realTimers, uuidv4, type Outcome, type Store, type Timers } from '../state/store';
import { browserThemeEnv, type ThemeEnv } from '../state/theme-store';

export type StickyPhase = 'loading' | 'ready' | 'invalid';

export interface StickyActions {
  setColor(color: NoteColorType): Promise<void>;
  setTextColor(color: HexColor | null): Promise<void>;
  togglePinned(): Promise<void>;
  toggleCollapsed(): Promise<void>;
  hide(): Promise<void>;
  /** "Open in app": flush, close this window and open the note in a tab. */
  dock(): Promise<void>;
  /** "Remove from stickies": flush, then dock and clear the sticky flag. */
  remove(): Promise<void>;
  /** Move to Trash (after the confirmation); the window then shows the trash state. */
  trash(): Promise<Outcome>;
  restore(): Promise<void>;
  quit(): Promise<void>;
}

export interface StickyServices {
  core: CoreServices;
  now: () => number;
  controller: NoteController;
  /** The window's sticky state from main (title, color, path, trash, collapse, pin, activation). */
  sticky: Store<{ current: StickyStateType | null }>;
  phase: Store<{ phase: StickyPhase }>;
  caps: Store<{ current: CapabilitiesType | null }>;
  actions: StickyActions;
  /** Bumped when main asks this window to focus its editor (a repeated Float). */
  focusEditor: Store<{ request: number }>;
  ready: Promise<void>;
  dispose(): Promise<void>;
}

export interface StickyDeps {
  now?: () => number;
  timers?: Timers;
  randomUUID?: () => string;
  themeEnv?: ThemeEnv | null;
  lifecycle?: { onHide(cb: () => void): () => void } | null;
}

const isTrashedConflict = (r: FlushResult): boolean =>
  !r.ok && r.code === 'CONFLICT' && (r.details as { reason?: unknown } | undefined)?.reason === 'trashed';

/**
 * Everything one sticky window runs (plan section 9.3): the shared core, one NoteController for its note, the sticky
 * state from main and the header actions. Main decides which note the window may use; the route is checked against
 * `window:getState`.
 */
export function createStickyServices(bridge: InfinityBridge, noteId: string, deps: StickyDeps = {}): StickyServices {
  const timers = deps.timers ?? realTimers;
  const uuid = deps.randomUUID ?? uuidv4;
  const core = createCoreServices(bridge, { timers, themeEnv: deps.themeEnv === undefined ? browserThemeEnv() : deps.themeEnv });
  const { notices } = core;
  const controller = new NoteController({ bridge, noteId, viewId: uuid(), timers, uuid });
  const sticky = createStore<{ current: StickyStateType | null }>({ current: null });
  const phase = createStore<{ phase: StickyPhase }>({ phase: 'loading' });
  const caps = createStore<{ current: CapabilitiesType | null }>({ current: null });
  const focusEditor = createStore({ request: 0 });
  let lastActivation = 0;

  const fail = (res: Result<unknown>): boolean => {
    if (res.ok) return false;
    notices.push(res.error.message, 'error');
    return true;
  };
  const current = () => sticky.getState().current;

  /** A new state from main: follow activations (float again: focus the text) and the trash transitions. */
  const applyState = (next: StickyStateType): void => {
    const previous = current();
    sticky.setState({ current: next });
    if (next.activation > lastActivation) {
      lastActivation = next.activation;
      focusEditor.setState((s) => ({ request: s.request + 1 }));
    }
    if (previous && !previous.trashed && next.trashed) {
      void controller.handleTrashed(next.trashed.batchId).then((flushed) => {
        if (isTrashedConflict(flushed)) notices.push(trashedDraftNotice(displayTitle(next.title)), 'info');
      });
    } else if (previous?.trashed && !next.trashed) {
      void controller.reopen();
    }
  };

  async function init(): Promise<void> {
    const state = await bridge.window.getState();
    if (!state.ok || state.data.role !== 'sticky' || state.data.sticky.noteId !== noteId) {
      phase.setState({ phase: 'invalid' });
      return;
    }
    const [, capabilities] = await Promise.all([core.loadSettings(), bridge.capabilities.get()]);
    if (capabilities.ok) caps.setState({ current: capabilities.data });
    const initial = state.data.sticky;
    lastActivation = initial.activation;
    sticky.setState({ current: initial });
    phase.setState({ phase: 'ready' });
    if (initial.trashed) {
      controller.store.setState({ status: 'trashed', trashBatchId: initial.trashed.batchId });
      return;
    }
    await controller.open();
    if (initial.activation > 0) focusEditor.setState((s) => ({ request: s.request + 1 }));
  }

  // Live sync with the note's other views (D-103).
  core.track(bridge.subscribe('collab:steps', (event) => controller.onSteps(event)));
  core.track(bridge.subscribe('collab:status', (event) => controller.onStatus(event)));
  core.track(bridge.subscribe('collab:reset', (event) => controller.onReset(event)));
  // OS close and quit (INF-SAVE-01, D-072): flush, then tell main whether the text is safe; if not, say why the
  // window stays open (or the app did not quit).
  core.track(
    bridge.subscribe('app:flush-request', ({ flushId, reason }) => {
      void controller.flush().then((result) => {
        const saved = textIsSafe(result);
        if (!saved) notices.push(unsavedFlushNotice(reason), 'error');
        return bridge.app.flushed({ flushId, saved });
      });
    }),
  );
  core.track(
    bridge.subscribe('sticky:state', (next) => {
      if (next.noteId === noteId && phase.getState().phase === 'ready') applyState(next);
    }),
  );
  const lifecycle = deps.lifecycle === undefined ? browserHideEvents() : deps.lifecycle;
  if (lifecycle) core.track(lifecycle.onHide(() => void controller.flush()));

  /**
   * Saves before an action that closes the window or moves the note (D-072). Without a 2 s cap the save retries run to
   * the end; when the text still is not safe the window stays open and says why.
   */
  const savedBeforeLeaving = async (): Promise<boolean> => {
    if (textIsSafe(await controller.flush())) return true;
    notices.push(WINDOW_KEPT_NOTICE, 'error');
    return false;
  };

  const updateFrom = (res: Result<StickyStateType | null>): void => {
    if (!fail(res) && res.ok && res.data) applyState(res.data);
  };

  const actions: StickyActions = {
    async setColor(color) {
      updateFrom(await bridge.sticky.setColor({ noteId, color }));
    },
    async setTextColor(textColor) {
      updateFrom(await bridge.sticky.setTextColor({ noteId, textColor }));
    },
    async togglePinned() {
      const state = current();
      if (!state || caps.getState().current?.alwaysOnTop.status === 'unsupported') return;
      updateFrom(await bridge.sticky.setPinned({ noteId, pinned: !state.alwaysOnTop }));
    },
    async toggleCollapsed() {
      const state = current();
      if (!state) return;
      updateFrom(await bridge.sticky.setCollapsed({ noteId, collapsed: !state.collapsed }));
    },
    async hide() {
      if (await savedBeforeLeaving()) fail(await bridge.sticky.hide({ noteId }));
    },
    async dock() {
      if (await savedBeforeLeaving()) fail(await bridge.sticky.dock({ noteId }));
    },
    async remove() {
      if (await savedBeforeLeaving()) fail(await bridge.sticky.remove({ noteId }));
    },
    async trash() {
      if (!(await savedBeforeLeaving())) return failOutcome('INTERNAL', WINDOW_KEPT_NOTICE);
      const res = await bridge.note.trash({ noteId });
      return res.ok ? okOutcome(undefined) : failOutcome(res.error.code, res.error.message);
    },
    async restore() {
      const res = await bridge.sticky.restore({ noteId });
      if (!fail(res) && res.ok) notices.push(restoreNotice(res.data), 'info');
    },
    async quit() {
      fail(await bridge.app.quit());
    },
  };

  const ready = init();
  return {
    core,
    now: deps.now ?? (() => Date.now()),
    controller,
    sticky,
    phase,
    caps,
    actions,
    focusEditor,
    ready,
    async dispose() {
      core.dispose();
      await controller.dispose();
    },
  };
}
