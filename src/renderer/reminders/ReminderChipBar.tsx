import { Bell } from 'lucide-react';
import type { ReminderDtoType } from '../../shared/contracts/reminders';
import { formatShort } from '../../shared/time/format';
import { chipLook } from '../editor/reminder-chips';
import { chipState, isAnchored, reminderInstant, reminderLabel } from './note-reminders';

export const BLOCK_REMOVED = 'Original text was removed';

/**
 * Reminders that are not shown inside the text (D-080): note-level reminders and those whose block was removed. In the
 * main window a click edits the reminder; in a sticky it opens the note in the main window.
 */
export function ReminderChipBar({
  reminders,
  displayZone,
  onSelect,
}: {
  reminders: readonly ReminderDtoType[];
  displayZone: string | null;
  onSelect: (reminder: ReminderDtoType) => void;
}) {
  const shown = reminders.filter((r) => !isAnchored(r));
  if (shown.length === 0) return null;
  return (
    <div className="reminder-chip-bar" role="group" aria-label="Note reminders">
      {shown.map((r) => {
        const look = chipLook({ state: chipState(r.current), ariaLabel: reminderLabel(r, displayZone), sourceChanged: r.source?.state === 'changed' });
        return (
          <button
            key={r.id}
            type="button"
            className={look.className}
            data-reminder-id={r.id}
            aria-label={r.anchorState === 'block_missing' ? `${look.ariaLabel}. ${BLOCK_REMOVED}` : look.ariaLabel}
            onClick={() => onSelect(r)}
          >
            <Bell size={12} strokeWidth={2} aria-hidden />
            {r.title} · {formatShort(reminderInstant(r), r.zoneId)}
            {r.anchorState === 'block_missing' ? <span className="reminder-chip-note">{BLOCK_REMOVED}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
