import type { KeyboardEvent } from 'react';
import type { ReminderViewType } from '../../shared/contracts/reminders';
import { UNKNOWN_ZONE_TEXT } from '../home/RemindersSection';
import { ReminderRow } from '../reminders/ReminderRow';
import { useServices, useStore } from '../state/use-store';

export const VIEW_LABELS: Record<ReminderViewType, string> = { today: 'Today', upcoming: 'Upcoming', overdue: 'Overdue', completed: 'Completed' };
export const EMPTY_TEXT: Record<ReminderViewType, string> = {
  today: 'Nothing due today.',
  upcoming: 'No upcoming reminders.',
  overdue: 'Nothing is overdue.',
  completed: 'No completed reminders in the last 30 days.',
};
const VIEWS: ReminderViewType[] = ['today', 'upcoming', 'overdue', 'completed'];

/** Today, Upcoming, Overdue and Completed (INF-REM-05), with the widget switch. */
export function RemindersPage() {
  const { reminders } = useServices();
  const state = useStore(reminders.store);
  const count = (view: ReminderViewType) => (view === 'completed' ? null : state.counts[view]);
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = VIEWS[(VIEWS.indexOf(state.view) + step + VIEWS.length) % VIEWS.length]!;
    void reminders.setView(next);
    requestAnimationFrame(() => document.getElementById(`reminders-tab-${next}`)?.focus());
  };
  return (
    <div className="page reminders-page">
      <div className="page-header">
        <h2 className="view-title">Reminders</h2>
        <button type="button" className="btn" onClick={() => void reminders.setWidgetOpen(!state.widget.open)}>
          {state.widget.open ? 'Hide widget' : 'Show widget'}
        </button>
      </div>
      {state.loaded && state.displayZone === null ? <p className="muted">{UNKNOWN_ZONE_TEXT}</p> : null}
      <div role="tablist" aria-label="Reminder views" className="reminder-tabs" onKeyDown={onKeyDown}>
        {VIEWS.map((view) => {
          const n = count(view);
          const selected = state.view === view;
          return (
            <button
              key={view}
              id={`reminders-tab-${view}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="reminders-list"
              aria-label={n === null ? VIEW_LABELS[view] : `${VIEW_LABELS[view]}, ${n}`}
              tabIndex={selected ? 0 : -1}
              className={`reminder-tab${selected ? ' is-on' : ''}`}
              onClick={() => void reminders.setView(view)}
            >
              {VIEW_LABELS[view]}
              {n !== null ? <span className="tab-count">{n}</span> : null}
            </button>
          );
        })}
      </div>
      <div id="reminders-list" role="tabpanel" aria-labelledby={`reminders-tab-${state.view}`}>
        {state.error ? <p role="alert">{state.error}</p> : null}
        {state.loaded && state.items.length === 0 ? <p className="muted">{EMPTY_TEXT[state.view]}</p> : null}
        <ul className="reminder-list">
          {state.items.map((item) => (
            <ReminderRow
              key={item.occurrenceId}
              item={item}
              displayZone={state.displayZone}
              actions={{
                open: () => void reminders.open(item),
                snooze: (preset) => void reminders.snooze(item, preset),
                done: () => void reminders.complete(item),
                edit: () => void reminders.edit(item.reminderId, item.noteId),
                delete: () => void reminders.delete(item.reminderId),
              }}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
