import { Recurrence, type FollowupType, type OccurrenceItemType, type RecurrenceType } from '../../shared/contracts/reminders';
import { pathOf, type PathIndex } from '../../shared/tree/paths';
import type { Series } from '../../shared/time/recurrence';
import type { OccurrenceItemRow, ReminderRow } from '../db/repositories/reminders-repo';

/** Mapping between reminder rows and the shapes the services, the scheduler and the renderer use. */

export function recurrenceOf(row: Pick<ReminderRow, 'recurrence'>): RecurrenceType {
  return row.recurrence === null ? null : Recurrence.parse(JSON.parse(row.recurrence));
}

export function followupOf(row: Pick<ReminderRow, 'followup_interval_minutes' | 'max_followups'>): FollowupType {
  return row.followup_interval_minutes === null
    ? null
    : ({ intervalMinutes: row.followup_interval_minutes, maxFollowups: row.max_followups } as NonNullable<FollowupType>);
}

/** The series of a recurring reminder, or null for a one-time reminder. */
export function seriesOf(row: ReminderRow): Series | null {
  const rule = recurrenceOf(row);
  return rule === null ? null : { rule, startDate: row.start_local_date, time: row.local_time, zoneId: row.zone_id, fold: row.fold_preference };
}

const isOpen = (state: string) => state === 'pending' || state === 'snoozed';

/** When an occurrence is next due: the snooze target while snoozed, else its due time. */
export function effectiveAt(row: Pick<OccurrenceItemRow, 'state' | 'snoozed_until_utc' | 'due_at_utc'>): number {
  return row.state === 'snoozed' && row.snoozed_until_utc !== null ? row.snoozed_until_utc : row.due_at_utc;
}

export function toOccurrenceItem(row: OccurrenceItemRow, now: number, paths: PathIndex): OccurrenceItemType {
  const effective = effectiveAt(row);
  return {
    occurrenceId: row.id,
    reminderId: row.reminder_id,
    noteId: row.note_id,
    blockId: row.block_id,
    anchorState: row.anchor_state,
    noteTitle: row.note_title,
    notePath: pathOf(paths, { projectId: row.project_id, folderId: row.folder_id }),
    title: row.title,
    zoneId: row.zone_id,
    dueAtUtc: row.due_at_utc,
    localDateTime: row.original_local_date_time,
    state: row.state,
    snoozedUntilUtc: row.snoozed_until_utc,
    effectiveAtUtc: effective,
    overdue: isOpen(row.state) && effective <= now,
    alertsSent: row.alert_sequence,
    followupsSent: row.followups_sent,
    repeat: row.repeat,
    lastOutcome: row.last_outcome === 'claimed' || row.last_outcome === 'skipped' ? null : row.last_outcome,
    completedAt: row.completed_at,
  };
}
