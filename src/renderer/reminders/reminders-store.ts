import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { HomeScopeType } from '../../shared/contracts/home';
import {
  ALERT_ITEMS_LIMIT,
  type OccurrenceItemType,
  type ReminderAlertEventType,
  type ReminderCountsType,
  type ReminderDtoType,
  type ReminderViewType,
  type RemindersSummaryResponseType,
  type SnoozePresetType,
} from '../../shared/contracts/reminders';
import type { WidgetStateType } from '../../shared/contracts/widget';
import type { NoticeStore } from '../state/notice-store';
import { createStore, type Store } from '../state/store';

export const REMINDER_DELETED = 'Reminder deleted';

/** An in-app alert (D-076): one reminder, or a summary once more than 3 are waiting. */
export type AlertEntry = { id: number; kind: 'single'; item: OccurrenceItemType } | { id: number; kind: 'summary'; total: number };

export interface RemindersState {
  view: ReminderViewType;
  items: OccurrenceItemType[];
  counts: ReminderCountsType;
  /** The zone days are counted in; null when the computer's zone is unknown (the views say days are in UTC). */
  displayZone: string | null;
  loaded: boolean;
  error: string | null;
  /** Home's Overdue and Due today in the Home scope. */
  summary: RemindersSummaryResponseType | null;
  widget: WidgetStateType;
  alerts: AlertEntry[];
  /** Overdue reminders found when the window opened ("N reminders are overdue"), until dismissed. */
  startupOverdue: number | null;
}

export interface RemindersDeps {
  bridge: InfinityBridge;
  notices: NoticeStore;
  tabs: {
    openNote(noteId: string, opts: { blockId?: string | null }): Promise<boolean>;
    openPage(kind: 'reminders'): Promise<boolean>;
  };
  homeScope(): HomeScopeType;
  /** Opens the edit dialog of a reminder. */
  openEditor(reminder: ReminderDtoType): void;
}

/** Runs `load` once at a time; calls during a run cause exactly one more run. */
function coalesced(load: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await load();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };
}

/**
 * The main window's reminder state (plan section 9.6): the Reminders page view, Home's summary, the widget state, the
 * in-app alerts and the startup overdue banner, plus the actions every list offers. Main pushes `reminder:changed`,
 * `reminder:alert`, `widget:state` and `app:openReminders`; this store re-reads instead of patching.
 */
export class RemindersStore {
  readonly store: Store<RemindersState>;
  private nextAlertId = 1;
  private readonly loadView = coalesced(() => this.readView());
  private readonly loadSummary = coalesced(() => this.readSummary());

  constructor(
    private readonly deps: RemindersDeps,
    widget: WidgetStateType,
  ) {
    this.store = createStore<RemindersState>({
      view: 'today',
      items: [],
      counts: { today: 0, upcoming: 0, overdue: 0 },
      displayZone: null,
      loaded: false,
      error: null,
      summary: null,
      widget,
      alerts: [],
      startupOverdue: null,
    });
  }

  private get state(): RemindersState {
    return this.store.getState();
  }

  private fail(message: string): void {
    this.deps.notices.push(message, 'error');
  }

  /** The startup banner, the first view and Home's summary; a view main asked for while the window loaded opens. */
  async init(openReminders: ReminderViewType | null): Promise<void> {
    const all = await this.deps.bridge.reminders.summary({ scope: { kind: 'all' } });
    if (all.ok && all.data.overdueTotal > 0) this.store.setState({ startupOverdue: all.data.overdueTotal });
    if (openReminders) await this.openView(openReminders);
    await Promise.all([this.loadView(), this.loadSummary()]);
  }

  private async readView(): Promise<void> {
    const view = this.state.view;
    const res = await this.deps.bridge.reminders.listView({ view });
    if (!res.ok) {
      this.store.setState({ error: res.error.message, loaded: true });
      return;
    }
    if (this.state.view !== view) return;
    this.store.setState({ items: res.data.items, counts: res.data.counts, displayZone: res.data.displayZone, loaded: true, error: null });
  }

  private async readSummary(): Promise<void> {
    const res = await this.deps.bridge.reminders.summary({ scope: this.deps.homeScope() });
    if (res.ok) this.store.setState({ summary: res.data, displayZone: res.data.displayZone });
  }

  setView(view: ReminderViewType): Promise<void> {
    if (view !== this.state.view) this.store.setState({ view, items: [] });
    return this.loadView();
  }

  /** `reminder:changed` (any reason): the visible view and Home's summary are read again. */
  refresh(): Promise<void> {
    return Promise.all([this.loadView(), this.loadSummary()]).then(() => undefined);
  }

  /** Home's scope changed. */
  refreshSummary(): Promise<void> {
    return this.loadSummary();
  }

  /** Opens the Reminders tab on a view (summary notification click, "Show overdue"). */
  async openView(view: ReminderViewType): Promise<void> {
    await this.deps.tabs.openPage('reminders');
    await this.setView(view);
  }

  // Alerts ----------------------------------------------------------------------------------
  /**
   * `reminder:alert`: a notification was not shown, so the alert appears in the window. Up to 3 reminders show one
   * by one; a 4th, or a summary from main, collapses them into "N reminders are overdue".
   */
  onAlert(event: ReminderAlertEventType): void {
    const incoming = event.items.map((item) => item.occurrenceId);
    const kept = this.state.alerts.filter((a) => a.kind === 'summary' || !incoming.includes(a.item.occurrenceId));
    const singles = event.presentation === 'single' ? event.items : [];
    const count = (list: AlertEntry[]) => list.reduce((n, a) => n + (a.kind === 'summary' ? a.total : 1), 0);
    const total = count(kept) + (event.presentation === 'single' ? singles.length : event.total);
    const collapse = event.presentation === 'summary' || kept.some((a) => a.kind === 'summary') || total > ALERT_ITEMS_LIMIT;
    const alerts: AlertEntry[] = collapse
      ? [{ id: this.nextAlertId++, kind: 'summary', total }]
      : [...kept, ...singles.map((item) => ({ id: this.nextAlertId++, kind: 'single' as const, item }))];
    this.store.setState({ alerts });
  }

  dismissAlert(id: number): void {
    this.store.setState({ alerts: this.state.alerts.filter((a) => a.id !== id) });
  }

  dismissStartup(): void {
    this.store.setState({ startupOverdue: null });
  }

  private settle(occurrenceId: string): void {
    this.store.setState({ alerts: this.state.alerts.filter((a) => a.kind === 'summary' || a.item.occurrenceId !== occurrenceId) });
  }

  // Actions ----------------------------------------------------------------------------------
  async complete(item: OccurrenceItemType): Promise<boolean> {
    const res = await this.deps.bridge.occurrence.complete({ occurrenceId: item.occurrenceId });
    if (!res.ok) {
      this.fail(res.error.message);
      return false;
    }
    this.settle(item.occurrenceId);
    return true;
  }

  async snooze(item: OccurrenceItemType, preset: SnoozePresetType): Promise<boolean> {
    const res = await this.deps.bridge.occurrence.snooze({ occurrenceId: item.occurrenceId, preset });
    if (!res.ok) {
      this.fail(res.error.message);
      return false;
    }
    this.settle(item.occurrenceId);
    return true;
  }

  /** Opens the reminder's note at its block (a block that was removed opens the note only). */
  open(item: OccurrenceItemType): Promise<boolean> {
    return this.deps.tabs.openNote(item.noteId, { blockId: item.anchorState === 'ok' ? item.blockId : null });
  }

  /** Deletes a reminder; the notice offers Undo for 10 seconds (INF-REM-18). */
  async delete(reminderId: string): Promise<void> {
    const res = await this.deps.bridge.reminder.delete({ reminderId });
    if (!res.ok) {
      this.fail(res.error.message);
      return;
    }
    this.deps.notices.push(REMINDER_DELETED, 'info', {
      label: 'Undo',
      run: () => {
        void this.deps.bridge.reminder.undoDelete({ reminderId }).then((undo) => {
          if (!undo.ok) this.fail(undo.error.message);
        });
      },
    });
  }

  /** Edit from a list: the reminder is read again from its note, then the dialog opens. */
  async edit(reminderId: string, noteId: string): Promise<void> {
    const res = await this.deps.bridge.reminder.listForNote({ noteId });
    const reminder = res.ok ? res.data.reminders.find((r) => r.id === reminderId) : undefined;
    if (reminder) this.deps.openEditor(reminder);
    else this.fail(res.ok ? 'This reminder no longer exists' : res.error.message);
  }

  /** Keep current time: the changed phrase stops following the text; the schedule stays (D-092). */
  async keepSource(reminderId: string): Promise<void> {
    const res = await this.deps.bridge.reminder.updateFromSource({ action: 'keep', reminderId });
    if (!res.ok) this.fail(res.error.message);
  }

  /** Attach to another block, or keep note-level (`null`); nothing else of the reminder changes (D-080). */
  async setAnchor(r: ReminderDtoType, blockId: string | null): Promise<void> {
    const res = await this.deps.bridge.reminder.update({
      reminderId: r.id,
      expectedRevision: r.revision,
      blockId,
      title: r.title,
      zoneId: r.zoneId,
      date: r.date,
      time: r.time,
      recurrence: r.recurrence,
      foldPreference: r.foldPreference,
      followup: r.followup,
    });
    if (!res.ok) this.fail(res.error.message);
  }

  // Widget ----------------------------------------------------------------------------------
  onWidgetState(widget: WidgetStateType): void {
    this.store.setState({ widget });
  }

  async setWidgetOpen(open: boolean): Promise<void> {
    const res = open ? await this.deps.bridge.widget.show() : await this.deps.bridge.widget.hide();
    if (res.ok) this.onWidgetState(res.data);
    else this.fail(res.error.message);
  }
}
