import { EMPTY_TEXT, VIEW_LABELS } from '../pages/RemindersPage';
import { ReminderRow } from '../reminders/ReminderRow';
import { useStore } from '../state/use-store';
import type { WidgetServices, WidgetView } from './widget-services';

const VIEWS: WidgetView[] = ['today', 'upcoming', 'overdue'];

/** Today, Upcoming and Overdue with counts, and the rows with Open, Snooze (overdue only) and Done (INF-WIDG-01). */
export function WidgetList({ services }: { services: WidgetServices }) {
  const state = useStore(services.store);
  return (
    <>
      <div role="tablist" aria-label="Reminder views" className="reminder-tabs widget-tabs">
        {VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={state.view === view}
            aria-label={`${VIEW_LABELS[view]}, ${state.counts[view]}`}
            className={`reminder-tab${state.view === view ? ' is-on' : ''}`}
            onClick={() => void services.setView(view)}
          >
            {VIEW_LABELS[view]}
            <span className="tab-count">{state.counts[view]}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={VIEW_LABELS[state.view]}>
        {state.loaded && state.items.length === 0 ? <p className="muted">{EMPTY_TEXT[state.view]}</p> : null}
        <ul className="reminder-list">
          {state.items.map((item) => (
            <ReminderRow
              key={item.occurrenceId}
              item={item}
              displayZone={state.displayZone}
              actions={{
                open: () => void services.open(item),
                snooze: (preset) => void services.snooze(item, preset),
                done: () => void services.complete(item),
              }}
            />
          ))}
        </ul>
      </div>
    </>
  );
}
