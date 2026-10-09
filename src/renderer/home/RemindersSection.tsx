import type { OccurrenceItemType } from '../../shared/contracts/reminders';
import { DueTime } from '../reminders/DueTime';
import { reminderSource } from '../reminders/ReminderRow';
import { useServices, useStore } from '../state/use-store';

export const UNKNOWN_ZONE_TEXT = "Your computer's time zone is unknown; days are shown in UTC.";

/** Home's Overdue and Due today reminders in the Home scope (INF-HOME-04), at most 5 of each. */
export function RemindersSection() {
  const { reminders } = useServices();
  const { summary } = useStore(reminders.store);
  const overdue = summary?.overdue ?? [];
  const today = summary?.today ?? [];
  const group = (label: string, id: string, items: OccurrenceItemType[]) =>
    items.length > 0 ? (
      <div className="home-reminder-group" role="group" aria-labelledby={id}>
        <h4 id={id} className="home-reminder-label">
          {label}
        </h4>
        <ul className="recent-list">
          {items.map((item) => (
            <li key={item.occurrenceId}>
              <button type="button" className="recent-row" onClick={() => void reminders.open(item)}>
                <span className="recent-title">{item.title}</span>
                <span className="muted recent-path">{reminderSource(item)}</span>
                <DueTime instant={item.dueAtUtc} zoneId={item.zoneId} displayZone={summary?.displayZone ?? null} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <section aria-labelledby="home-reminders">
      <h3 id="home-reminders" className="section-label">
        Reminders
      </h3>
      {summary && summary.displayZone === null ? <p className="muted">{UNKNOWN_ZONE_TEXT}</p> : null}
      {overdue.length === 0 && today.length === 0 ? <p className="muted">Nothing overdue or due today.</p> : null}
      {group('Overdue', 'home-overdue', overdue)}
      {group('Due today', 'home-today', today)}
      <button type="button" className="link-btn" onClick={() => void reminders.openView(overdue.length > 0 ? 'overdue' : 'today')}>
        Open Reminders
      </button>
    </section>
  );
}
