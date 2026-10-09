import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { OccurrenceItemType, ReminderCountsType, SnoozePresetType } from '../../shared/contracts/reminders';
import type { WidgetStateType } from '../../shared/contracts/widget';
import { createCoreServices, type CoreServices } from '../state/core-services';
import { createStore, realTimers, type Store, type Timers } from '../state/store';
import { browserThemeEnv, type ThemeEnv } from '../state/theme-store';

export type WidgetView = 'today' | 'upcoming' | 'overdue';

export interface WidgetViewState {
  view: WidgetView;
  items: OccurrenceItemType[];
  counts: ReminderCountsType;
  displayZone: string | null;
  loaded: boolean;
  window: WidgetStateType;
  pinSupported: boolean;
}

export interface WidgetServices {
  core: CoreServices;
  store: Store<WidgetViewState>;
  setView(view: WidgetView): Promise<void>;
  open(item: OccurrenceItemType): Promise<void>;
  complete(item: OccurrenceItemType): Promise<void>;
  snooze(item: OccurrenceItemType, preset: SnoozePresetType): Promise<void>;
  togglePinned(): Promise<void>;
  toggleCollapsed(): Promise<void>;
  hide(): Promise<void>;
  ready: Promise<void>;
  dispose(): void;
}

/**
 * What the reminder widget runs (D-081, plan section 9.9): the shared core (theme, notices), one view of
 * `reminders:listView` with its counts, and its window controls. It owns no scheduler; main's `reminder:changed` makes
 * it read again, so it stays in step with the main window (INF-WIDG-03).
 */
export function createWidgetServices(
  bridge: InfinityBridge,
  initial: WidgetStateType,
  deps: { timers?: Timers; themeEnv?: ThemeEnv | null } = {},
): WidgetServices {
  const core = createCoreServices(bridge, { timers: deps.timers ?? realTimers, themeEnv: deps.themeEnv === undefined ? browserThemeEnv() : deps.themeEnv });
  const store = createStore<WidgetViewState>({
    view: 'overdue',
    items: [],
    counts: { today: 0, upcoming: 0, overdue: 0 },
    displayZone: null,
    loaded: false,
    window: initial,
    pinSupported: true,
  });
  const fail = (message: string) => core.notices.push(message, 'error');

  const load = async (view: WidgetView): Promise<void> => {
    const res = await bridge.reminders.listView({ view });
    if (!res.ok) {
      fail(res.error.message);
      return;
    }
    if (store.getState().view === view) store.setState({ items: res.data.items, counts: res.data.counts, displayZone: res.data.displayZone, loaded: true });
  };

  const setView = (view: WidgetView): Promise<void> => {
    store.setState({ view });
    return load(view);
  };

  async function init(): Promise<void> {
    const [, caps] = await Promise.all([core.loadSettings(), bridge.capabilities.get()]);
    if (caps.ok) store.setState({ pinSupported: caps.data.alwaysOnTop.status !== 'unsupported' });
    // The widget opens on Overdue when something is overdue, else on Today.
    await load('overdue');
    if (store.getState().counts.overdue === 0) await setView('today');
  }

  core.track(bridge.subscribe('reminder:changed', () => void load(store.getState().view)));
  core.track(bridge.subscribe('widget:state', (window) => store.setState({ window })));
  // No editor: nothing to save, so a close or quit never waits for the widget (R5-13).
  core.track(bridge.subscribe('app:flush-request', ({ flushId }) => void bridge.app.flushed({ flushId, saved: true })));

  const act = async (call: () => ReturnType<InfinityBridge['occurrence']['complete']>) => {
    const res = await call();
    if (!res.ok) fail(res.error.message);
  };
  const windowCall = async (call: () => ReturnType<InfinityBridge['widget']['hide']>) => {
    const res = await call();
    if (res.ok) store.setState({ window: res.data });
    else fail(res.error.message);
  };

  return {
    core,
    store,
    setView,
    async open(item) {
      const res = await bridge.reminder.open({ reminderId: item.reminderId });
      if (!res.ok) fail(res.error.message);
    },
    complete: (item) => act(() => bridge.occurrence.complete({ occurrenceId: item.occurrenceId })),
    snooze: (item, preset) => act(() => bridge.occurrence.snooze({ occurrenceId: item.occurrenceId, preset })),
    async togglePinned() {
      const { window, pinSupported } = store.getState();
      if (pinSupported) await windowCall(() => bridge.widget.setPinned({ pinned: !window.alwaysOnTop }));
    },
    toggleCollapsed: () => windowCall(() => bridge.widget.setCollapsed({ collapsed: !store.getState().window.collapsed })),
    hide: () => windowCall(() => bridge.widget.hide()),
    ready: init(),
    dispose: () => core.dispose(),
  };
}
