import { Ellipsis, Repeat } from 'lucide-react';
import { useRef, useState } from 'react';
import type { OccurrenceItemType, SnoozePresetType } from '../../shared/contracts/reminders';
import { displayTitle } from '../../shared/names';
import { formatShort } from '../../shared/time/format';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { DueTime } from './DueTime';
import { SnoozeButton } from './SnoozeMenu';

export interface ReminderRowActions {
  open(): void;
  snooze(preset: SnoozePresetType): void;
  done(): void;
  /** Edit and Delete live in the row's menu; the widget has neither. */
  edit?(): void;
  delete?(): void;
}

const isOpen = (item: OccurrenceItemType) => item.state === 'pending' || item.state === 'snoozed';

/** Where a reminder lives: its note's path and title. */
export const reminderSource = (item: OccurrenceItemType): string => [...item.notePath, displayTitle(item.noteTitle)].join(' › ');

/** State badges of a reminder row (INF-REM-05): Overdue, Snoozed until …, Missed, Done, Repeats daily/weekly. */
export function ReminderBadges({ item }: { item: OccurrenceItemType }) {
  return (
    <span className="reminder-badges">
      {item.overdue ? <span className="badge badge-overdue">Overdue</span> : null}
      {item.state === 'snoozed' && item.snoozedUntilUtc !== null ? <span className="badge">Snoozed until {formatShort(item.snoozedUntilUtc, item.zoneId)}</span> : null}
      {item.state === 'missed' ? <span className="badge">Missed</span> : null}
      {item.state === 'completed' ? <span className="badge badge-done">Done</span> : null}
      {item.repeat ? (
        <span className="badge" title={`Repeats ${item.repeat}`}>
          <Repeat size={12} strokeWidth={1.75} aria-hidden />
          Repeats {item.repeat}
        </span>
      ) : null}
    </span>
  );
}

/** One occurrence in the Reminders page or the widget: title, source, due lines, badges and actions. */
export function ReminderRow({ item, displayZone, actions }: { item: OccurrenceItemType; displayZone: string | null; actions: ReminderRowActions }) {
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuItems = [
    ...(actions.edit ? [{ id: 'edit', label: 'Edit', onSelect: actions.edit }] : []),
    ...(actions.delete ? [{ id: 'delete', label: 'Delete', onSelect: actions.delete }] : []),
  ];
  return (
    <li className={`reminder-row${item.overdue ? ' is-overdue' : ''}`} aria-label={item.title}>
      <div className="reminder-main">
        <span className="reminder-title">{item.title}</span>
        <span className="muted reminder-source">{reminderSource(item)}</span>
        <DueTime instant={item.dueAtUtc} zoneId={item.zoneId} displayZone={displayZone} />
        <ReminderBadges item={item} />
      </div>
      <div className="reminder-actions">
        <button type="button" className="btn btn-small" onClick={actions.open}>
          Open
        </button>
        {item.overdue ? <SnoozeButton onSnooze={actions.snooze} /> : null}
        {isOpen(item) ? (
          <button type="button" className="btn btn-small" onClick={actions.done}>
            Done
          </button>
        ) : null}
        {menuItems.length > 0 ? (
          <IconButton
            label="Reminder actions"
            icon={Ellipsis}
            buttonRef={moreRef}
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            onClick={() => {
              const r = moreRef.current!.getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom + 2 });
            }}
          />
        ) : null}
        {menu ? <Menu label="Reminder actions" anchor={menu} items={menuItems} onClose={() => setMenu(null)} /> : null}
      </div>
    </li>
  );
}
