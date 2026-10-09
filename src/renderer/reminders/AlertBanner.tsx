import { overdueText } from '../../shared/contracts/reminders';
import { dueLines } from '../../shared/time/format';
import { useServices, useStore } from '../state/use-store';
import { SnoozeButton } from './SnoozeMenu';

/**
 * In-app reminder alerts (D-076, plan section 9.6): the startup overdue banner and the alerts whose notification was not
 * shown ("Reminder: <title>" with Open, Snooze, Done, Dismiss; more than 3 become "N reminders are overdue").
 */
export function AlertBanner() {
  const { reminders } = useServices();
  const { alerts, startupOverdue, displayZone } = useStore(reminders.store);
  if (alerts.length === 0 && startupOverdue === null) return null;
  const showOverdue = (dismiss: () => void) => (
    <>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => {
          dismiss();
          void reminders.openView('overdue');
        }}
      >
        Show overdue
      </button>
      <button type="button" className="btn btn-small" onClick={dismiss}>
        Dismiss
      </button>
    </>
  );
  return (
    <div className="alert-banners" role="status" aria-label="Reminder alerts">
      {startupOverdue !== null ? (
        <div className="banner alert-banner">
          <span className="alert-text">{overdueText(startupOverdue)}</span>
          {showOverdue(() => reminders.dismissStartup())}
        </div>
      ) : null}
      {alerts.map((alert) =>
        alert.kind === 'summary' ? (
          <div key={alert.id} className="banner alert-banner">
            <span className="alert-text">{overdueText(alert.total)}</span>
            {showOverdue(() => reminders.dismissAlert(alert.id))}
          </div>
        ) : (
          <div key={alert.id} className="banner alert-banner">
            <span className="alert-text">
              <strong>Reminder: {alert.item.title}</strong>
              <span className="muted">Due {dueLines(alert.item.dueAtUtc, alert.item.zoneId, displayZone).primary}</span>
            </span>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                reminders.dismissAlert(alert.id);
                void reminders.open(alert.item);
              }}
            >
              Open
            </button>
            <SnoozeButton onSnooze={(preset) => void reminders.snooze(alert.item, preset)} />
            <button type="button" className="btn btn-small" onClick={() => void reminders.complete(alert.item)}>
              Done
            </button>
            <button type="button" className="btn btn-small" onClick={() => reminders.dismissAlert(alert.id)}>
              Dismiss
            </button>
          </div>
        ),
      )}
    </div>
  );
}
