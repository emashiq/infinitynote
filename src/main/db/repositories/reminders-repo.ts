import type { HomeScopeType } from '../../../shared/contracts/home';
import type { OccurrenceStateType, ReminderViewType } from '../../../shared/contracts/reminders';
import type { Db } from '../driver';

export interface ReminderRow {
  id: string;
  note_id: string;
  block_id: string | null;
  anchor_state: 'ok' | 'block_missing';
  title: string;
  zone_id: string;
  start_local_date: string;
  local_time: string;
  /** JSON of the recurrence rule, or null for a one-time reminder. */
  recurrence: string | null;
  fold_preference: 'earlier' | 'later';
  followup_interval_minutes: number | null;
  max_followups: number;
  enabled: number;
  revision: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface OccurrenceRow {
  id: string;
  reminder_id: string;
  due_at_utc: number;
  original_local_date_time: string;
  state: OccurrenceStateType;
  snoozed_until_utc: number | null;
  next_alert_at_utc: number | null;
  alert_sequence: number;
  followups_sent: number;
  revision: number;
  completed_at: number | null;
}

/** An occurrence with what lists, chips and alerts show about its reminder and note. */
export interface OccurrenceItemRow extends OccurrenceRow {
  note_id: string;
  block_id: string | null;
  anchor_state: 'ok' | 'block_missing';
  title: string;
  zone_id: string;
  /** The series' frequency from its recurrence JSON, or null for a one-time reminder. */
  repeat: 'daily' | 'weekly' | null;
  followup_interval_minutes: number | null;
  max_followups: number;
  note_title: string;
  /** 1 when the note is locked: a notification must not show the reminder's text (D-112). */
  note_locked: number;
  project_id: string | null;
  folder_id: string | null;
  last_outcome: DeliveryRecordOutcome | null;
}

/** A delivery's recorded outcome; `skipped` is a claim that Done, Snooze or an edit overtook before it was shown. */
export type DeliveryRecordOutcome = 'claimed' | 'dispatched' | 'failed' | 'unsupported' | 'uncertain' | 'skipped';

export type ReminderSeriesFields = Pick<ReminderRow, 'zone_id' | 'start_local_date' | 'local_time' | 'recurrence' | 'fold_preference'>;
export type ReminderDetailFields = Pick<ReminderRow, 'title' | 'block_id' | 'anchor_state' | 'followup_interval_minutes' | 'max_followups'>;

export interface NewOccurrence {
  id: string;
  reminderId: string;
  dueAtUtc: number;
  originalLocalDateTime: string;
  nextAlertAtUtc: number | null;
  now: number;
}

export interface NewDelivery {
  id: string;
  occurrenceId: string;
  alertSequence: number;
  kind: 'initial' | 'followup' | 'snooze';
  presentation: 'single' | 'summary';
  batchId: string;
  reason: string;
  claimedAt: number;
}

export interface DeliveryRow {
  id: string;
  occurrence_id: string;
  alert_sequence: number;
  kind: string;
  presentation: 'single' | 'summary';
  batch_id: string;
  reason: string;
  claimed_at: number;
  outcome: string;
  dispatched_at: number | null;
  detail: string | null;
  closed_at: number | null;
  clicked_at: number | null;
}

/** The instants that split the views (plan section 9.3). */
export interface ViewBounds {
  now: number;
  /** Start of tomorrow in the display zone. */
  endOfToday: number;
  /** Completed and missed occurrences after this instant are listed under Completed. */
  completedSince: number;
}

const REMINDER_COLS =
  'id, note_id, block_id, anchor_state, title, zone_id, start_local_date, local_time, recurrence, fold_preference, followup_interval_minutes, max_followups, enabled, revision, created_at, updated_at, deleted_at';
const R_REMINDER_COLS = REMINDER_COLS.split(', ')
  .map((c) => `r.${c}`)
  .join(', ');
const OCCURRENCE_COLS =
  'o.id, o.reminder_id, o.due_at_utc, o.original_local_date_time, o.state, o.snoozed_until_utc, o.next_alert_at_utc, o.alert_sequence, o.followups_sent, o.revision, o.completed_at';

const ITEM_SELECT = `SELECT ${OCCURRENCE_COLS},
  r.note_id, r.block_id, r.anchor_state, r.title, r.zone_id, json_extract(r.recurrence, '$.freq') AS repeat, r.followup_interval_minutes, r.max_followups,
  n.title AS note_title, n.locked AS note_locked, n.project_id, n.folder_id,
  (SELECT d.outcome FROM alert_deliveries d WHERE d.occurrence_id = o.id ORDER BY d.alert_sequence DESC LIMIT 1) AS last_outcome
FROM occurrences o JOIN reminders r ON r.id = o.reminder_id JOIN notes n ON n.id = r.note_id`;

/** Suspension is derived (D-073): only live, enabled reminders on live notes alert or show in the views. */
const LIVE = 'r.deleted_at IS NULL AND r.enabled = 1 AND n.deleted_at IS NULL';
const OPEN = "o.state IN ('pending', 'snoozed')";
const EFFECTIVE = "(CASE WHEN o.state = 'snoozed' THEN o.snoozed_until_utc ELSE o.due_at_utc END)";

const VIEW_WHERE: Record<ReminderViewType, string> = {
  overdue: `${OPEN} AND ${EFFECTIVE} <= @now`,
  today: `${OPEN} AND ${EFFECTIVE} > @now AND ${EFFECTIVE} < @endOfToday`,
  upcoming: `${OPEN} AND ${EFFECTIVE} >= @endOfToday`,
  completed: "((o.state = 'completed' AND o.completed_at >= @completedSince) OR (o.state = 'missed' AND o.due_at_utc >= @completedSince))",
};
const VIEW_ORDER: Record<ReminderViewType, string> = {
  overdue: `${EFFECTIVE} ASC, o.id`,
  today: `${EFFECTIVE} ASC, o.id`,
  upcoming: `${EFFECTIVE} ASC, o.id`,
  completed: 'COALESCE(o.completed_at, o.due_at_utc) DESC, o.id',
};

function scopeSql(scope: HomeScopeType): { sql: string; projectId: string | null } {
  if (scope.kind === 'common') return { sql: ' AND n.project_id IS NULL', projectId: null };
  if (scope.kind === 'project') return { sql: ' AND n.project_id = @projectId', projectId: scope.projectId };
  return { sql: '', projectId: null };
}

const json = (ids: readonly string[]) => JSON.stringify(ids);

/** All SQL of reminders, their occurrences and alert deliveries (D-073). Callers own the transactions. */
export class RemindersRepo {
  constructor(private readonly db: Db) {}

  // Reminders ----------------------------------------------------------------------------------
  getReminder(id: string): ReminderRow | undefined {
    return this.db.prepare<[string], ReminderRow>(`SELECT ${REMINDER_COLS} FROM reminders WHERE id = ?`).get(id);
  }

  insertReminder(row: Omit<ReminderRow, 'enabled' | 'revision' | 'deleted_at'>): void {
    this.db
      .prepare(
        `INSERT INTO reminders(id, note_id, block_id, anchor_state, title, zone_id, start_local_date, local_time, recurrence, fold_preference,
           followup_interval_minutes, max_followups, created_at, updated_at)
         VALUES (@id, @note_id, @block_id, @anchor_state, @title, @zone_id, @start_local_date, @local_time, @recurrence, @fold_preference,
           @followup_interval_minutes, @max_followups, @created_at, @updated_at)`,
      )
      .run(row);
  }

  /** Writes every editable field and bumps the revision. */
  updateReminder(id: string, fields: ReminderSeriesFields & ReminderDetailFields, now: number): void {
    this.db
      .prepare(
        `UPDATE reminders SET title = @title, block_id = @block_id, anchor_state = @anchor_state, zone_id = @zone_id,
           start_local_date = @start_local_date, local_time = @local_time, recurrence = @recurrence, fold_preference = @fold_preference,
           followup_interval_minutes = @followup_interval_minutes, max_followups = @max_followups, revision = revision + 1, updated_at = @now
         WHERE id = @id`,
      )
      .run({ ...fields, id, now });
  }

  setDeletedAt(id: string, deletedAt: number | null): void {
    this.db.prepare<[number | null, string]>('UPDATE reminders SET deleted_at = ? WHERE id = ?').run(deletedAt, id);
  }

  countLiveForNote(noteId: string): number {
    return this.db.prepare<[string], { n: number }>('SELECT count(*) AS n FROM reminders WHERE note_id = ? AND deleted_at IS NULL').get(noteId)?.n ?? 0;
  }

  liveForNote(noteId: string): ReminderRow[] {
    return this.db
      .prepare<[string], ReminderRow>(`SELECT ${REMINDER_COLS} FROM reminders WHERE note_id = ? AND deleted_at IS NULL ORDER BY created_at, id`)
      .all(noteId);
  }

  /** Live block-anchored reminders of a note, for the anchor sync inside content writes. */
  anchoredOf(noteId: string): Array<{ id: string; block_id: string; anchor_state: 'ok' | 'block_missing' }> {
    return this.db
      .prepare<[string], { id: string; block_id: string; anchor_state: 'ok' | 'block_missing' }>(
        'SELECT id, block_id, anchor_state FROM reminders WHERE note_id = ? AND block_id IS NOT NULL AND deleted_at IS NULL',
      )
      .all(noteId);
  }

  setAnchorState(id: string, state: 'ok' | 'block_missing'): void {
    this.db.prepare<[string, string]>('UPDATE reminders SET anchor_state = ? WHERE id = ?').run(state, id);
  }

  /** Live recurring series with no open occurrence due after `now` (they need the next one generated). */
  recurringWithoutFutureOpen(now: number): ReminderRow[] {
    return this.db
      .prepare<[number], ReminderRow>(
        `SELECT ${R_REMINDER_COLS} FROM reminders r JOIN notes n ON n.id = r.note_id
         WHERE r.recurrence IS NOT NULL AND ${LIVE}
           AND NOT EXISTS (SELECT 1 FROM occurrences o WHERE o.reminder_id = r.id AND ${OPEN} AND o.due_at_utc > ?)`,
      )
      .all(now);
  }

  // Occurrences ----------------------------------------------------------------------------------
  getOccurrence(id: string): OccurrenceRow | undefined {
    return this.db.prepare<[string], OccurrenceRow>(`SELECT ${OCCURRENCE_COLS} FROM occurrences o WHERE o.id = ?`).get(id);
  }

  /** Inserts a pending occurrence; an existing row at the same instant counts as that occurrence (returns false). */
  insertOccurrence(o: NewOccurrence): boolean {
    return (
      this.db
        .prepare(
          `INSERT INTO occurrences(id, reminder_id, due_at_utc, original_local_date_time, state, next_alert_at_utc, created_at, updated_at)
           VALUES (@id, @reminderId, @dueAtUtc, @originalLocalDateTime, 'pending', @nextAlertAtUtc, @now, @now)
           ON CONFLICT(reminder_id, due_at_utc) DO NOTHING`,
        )
        .run(o).changes === 1
    );
  }

  newestDue(reminderId: string): number | null {
    return this.db.prepare<[string], { t: number | null }>('SELECT MAX(due_at_utc) AS t FROM occurrences WHERE reminder_id = ?').get(reminderId)?.t ?? null;
  }

  openOccurrences(reminderId: string): OccurrenceRow[] {
    return this.db
      .prepare<[string], OccurrenceRow>(`SELECT ${OCCURRENCE_COLS} FROM occurrences o WHERE o.reminder_id = ? AND ${OPEN} ORDER BY o.due_at_utc`)
      .all(reminderId);
  }

  hasDeliveries(occurrenceId: string): boolean {
    return this.db.prepare<[string], { n: number }>('SELECT count(*) AS n FROM alert_deliveries WHERE occurrence_id = ?').get(occurrenceId)!.n > 0;
  }

  deleteOccurrence(id: string): void {
    this.db.prepare<[string]>('DELETE FROM occurrences WHERE id = ?').run(id);
  }

  setOriginalLocal(id: string, originalLocalDateTime: string, now: number): void {
    this.db.prepare<[string, number, string]>('UPDATE occurrences SET original_local_date_time = ?, updated_at = ? WHERE id = ?').run(originalLocalDateTime, now, id);
  }

  /** Done (INF-REM-09): never conditional on the caller's revision, so it always wins over a prepared claim (D-075). */
  complete(id: string, now: number): boolean {
    return (
      this.db
        .prepare<[number, number, string]>(
          `UPDATE occurrences SET state = 'completed', completed_at = ?, next_alert_at_utc = NULL, snoozed_until_utc = NULL, revision = revision + 1, updated_at = ?
           WHERE id = ? AND state IN ('pending', 'snoozed', 'missed')`,
        )
        .run(now, now, id).changes === 1
    );
  }

  /** Snooze (INF-REM-10): replaces the next alert; like Done it always wins over a prepared claim. */
  snooze(id: string, until: number, now: number): boolean {
    return (
      this.db
        .prepare<[number, number, number, string]>(
          `UPDATE occurrences SET state = 'snoozed', snoozed_until_utc = ?, next_alert_at_utc = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND state IN ('pending', 'snoozed')`,
        )
        .run(until, until, now, id).changes === 1
    );
  }

  /**
   * After an edit of the follow-up settings (INF-REM-11, INF-REM-13): a pending occurrence that already alerted gets the
   * follow-up the new settings give, counted from its last alert, or none when follow-ups are off or the new maximum is
   * reached. A snoozed occurrence keeps its snooze alert. Every open occurrence of the reminder takes a new revision, so a
   * claim prepared under the old settings loses (D-075).
   */
  retargetFollowups(reminderId: string, intervalMinutes: number | null, maxFollowups: number, now: number): void {
    this.db
      .prepare(
        `UPDATE occurrences SET
           next_alert_at_utc = CASE
             WHEN state <> 'pending' OR alert_sequence = 0 THEN next_alert_at_utc
             WHEN @intervalMinutes IS NULL OR followups_sent >= @maxFollowups THEN NULL
             ELSE last_alert_at_utc + @intervalMinutes * 60000 END,
           revision = revision + 1, updated_at = @now
         WHERE reminder_id = @reminderId AND state IN ('pending', 'snoozed')`,
      )
      .run({ reminderId, intervalMinutes, maxFollowups, now });
  }

  /** An occurrence that already alerted and was replaced by an edit of its one-time reminder. */
  cancel(id: string, now: number): void {
    this.db
      .prepare<[number, string]>(
        "UPDATE occurrences SET state = 'cancelled', next_alert_at_utc = NULL, snoozed_until_utc = NULL, revision = revision + 1, updated_at = ? WHERE id = ?",
      )
      .run(now, id);
  }

  /** Open occurrences of a series older than `beforeDue` become missed (one open overdue occurrence per series). */
  markOlderMissed(reminderId: string, beforeDue: number, now: number): number {
    return this.db
      .prepare<[number, string, number]>(
        `UPDATE occurrences SET state = 'missed', next_alert_at_utc = NULL, snoozed_until_utc = NULL, revision = revision + 1, updated_at = ?
         WHERE reminder_id = ? AND state IN ('pending', 'snoozed') AND due_at_utc < ?`,
      )
      .run(now, reminderId, beforeDue).changes;
  }

  // Items for views, chips and alerts ----------------------------------------------------------------
  itemById(occurrenceId: string): OccurrenceItemRow | undefined {
    return this.db.prepare<[string], OccurrenceItemRow>(`${ITEM_SELECT} WHERE o.id = ?`).get(occurrenceId);
  }

  itemsByIds(occurrenceIds: readonly string[]): OccurrenceItemRow[] {
    return this.db.prepare<[string], OccurrenceItemRow>(`${ITEM_SELECT} WHERE o.id IN (SELECT value FROM json_each(?))`).all(json(occurrenceIds));
  }

  /**
   * The occurrence each reminder shows (chips, panel, dialog): the open one due first, else the latest completed one.
   */
  currentItems(reminderIds: readonly string[]): OccurrenceItemRow[] {
    return this.db
      .prepare<[string], OccurrenceItemRow>(
        `${ITEM_SELECT} WHERE o.id IN (
           SELECT id FROM (
             SELECT o2.id, ROW_NUMBER() OVER (
               PARTITION BY o2.reminder_id
               ORDER BY CASE WHEN o2.state IN ('pending', 'snoozed') THEN 0 ELSE 1 END,
                        CASE WHEN o2.state = 'snoozed' THEN o2.snoozed_until_utc ELSE o2.due_at_utc END ASC,
                        o2.completed_at DESC
             ) AS rn
             FROM occurrences o2
             WHERE o2.reminder_id IN (SELECT value FROM json_each(?)) AND o2.state IN ('pending', 'snoozed', 'completed')
           ) WHERE rn = 1)`,
      )
      .all(json(reminderIds));
  }

  viewItems(view: ReminderViewType, bounds: ViewBounds, scope: HomeScopeType, limit: number): OccurrenceItemRow[] {
    const s = scopeSql(scope);
    return this.db
      .prepare<[Record<string, unknown>], OccurrenceItemRow>(`${ITEM_SELECT} WHERE ${LIVE} AND ${VIEW_WHERE[view]}${s.sql} ORDER BY ${VIEW_ORDER[view]} LIMIT @limit`)
      .all({ ...bounds, projectId: s.projectId, limit });
  }

  viewCount(view: ReminderViewType, bounds: ViewBounds, scope: HomeScopeType): number {
    const s = scopeSql(scope);
    return (
      this.db
        .prepare<[Record<string, unknown>], { n: number }>(
          `SELECT count(*) AS n FROM occurrences o JOIN reminders r ON r.id = o.reminder_id JOIN notes n ON n.id = r.note_id
           WHERE ${LIVE} AND ${VIEW_WHERE[view]}${s.sql}`,
        )
        .get({ ...bounds, projectId: s.projectId })?.n ?? 0
    );
  }

  // Scheduler ----------------------------------------------------------------------------------
  /**
   * Live open occurrences whose next alert is due, oldest first and, at the same instant, in the order they were
   * created (uses occurrences_next_alert). `after` continues past the last row of the previous page, as it was read, so
   * one tick reads every due row exactly once.
   */
  dueForAlert(now: number, limit: number, after: OccurrenceRow | null = null): OccurrenceItemRow[] {
    const cursor = after
      ? 'AND (o.next_alert_at_utc, o.due_at_utc, o.rowid) > (@afterNext, @afterDue, (SELECT rowid FROM occurrences WHERE id = @afterId))'
      : '';
    return this.db
      .prepare<[Record<string, unknown>], OccurrenceItemRow>(
        `${ITEM_SELECT} WHERE o.next_alert_at_utc IS NOT NULL AND o.next_alert_at_utc <= @now AND ${OPEN} AND ${LIVE} ${cursor}
         ORDER BY o.next_alert_at_utc, o.due_at_utc, o.rowid LIMIT @limit`,
      )
      .all({ now, limit, ...(after ? { afterNext: after.next_alert_at_utc, afterDue: after.due_at_utc, afterId: after.id } : {}) });
  }

  /** Which of these claimed occurrences may still be shown: pending, on a live reminder and note (no user action since). */
  stillAlerting(occurrenceIds: readonly string[]): Set<string> {
    const rows = this.db
      .prepare<[string], { id: string }>(
        `SELECT o.id FROM occurrences o JOIN reminders r ON r.id = o.reminder_id JOIN notes n ON n.id = r.note_id
         WHERE o.id IN (SELECT value FROM json_each(?)) AND o.state = 'pending' AND ${LIVE}`,
      )
      .all(json(occurrenceIds));
    return new Set(rows.map((r) => r.id));
  }

  static readonly MIN_NEXT_ALERT_SQL = `SELECT o.next_alert_at_utc AS t FROM occurrences o JOIN reminders r ON r.id = o.reminder_id JOIN notes n ON n.id = r.note_id
     WHERE o.next_alert_at_utc IS NOT NULL AND ${OPEN} AND ${LIVE} ORDER BY o.next_alert_at_utc LIMIT 1`;

  /** The earliest next alert of a live occurrence, with the same filter as dueForAlert (no busy loop on suspended rows). */
  minNextAlert(): number | null {
    return this.db.prepare<[], { t: number }>(RemindersRepo.MIN_NEXT_ALERT_SQL).get()?.t ?? null;
  }

  /**
   * Claims the next alert of an occurrence (D-075): only while it still has the revision the tick read and is still
   * due, so Done, Snooze or an edit that landed first wins. Returns false when nothing was claimed.
   */
  claim(o: { id: string; revision: number; followupsSent: number; nextAlertAtUtc: number | null }, now: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE occurrences SET alert_sequence = alert_sequence + 1, followups_sent = @followupsSent, state = 'pending', snoozed_until_utc = NULL,
             last_alert_at_utc = @now, next_alert_at_utc = @nextAlertAtUtc, revision = revision + 1, updated_at = @now
           WHERE id = @id AND revision = @revision AND state IN ('pending', 'snoozed') AND next_alert_at_utc IS NOT NULL AND next_alert_at_utc <= @now`,
        )
        .run({ ...o, now }).changes === 1
    );
  }

  /** Moves every due alert of a live occurrence to the end of quiet hours; returns how many moved. */
  deferDue(now: number, until: number): number {
    return this.db
      .prepare<[number, number, number]>(
        `UPDATE occurrences SET next_alert_at_utc = ?, revision = revision + 1, updated_at = ?
         WHERE next_alert_at_utc IS NOT NULL AND next_alert_at_utc <= ? AND state IN ('pending', 'snoozed')
           AND reminder_id IN (SELECT r.id FROM reminders r JOIN notes n ON n.id = r.note_id WHERE ${LIVE})`,
      )
      .run(until, now, now).changes;
  }

  // Deliveries ----------------------------------------------------------------------------------
  insertDelivery(d: NewDelivery): void {
    this.db
      .prepare(
        `INSERT INTO alert_deliveries(id, occurrence_id, alert_sequence, kind, presentation, batch_id, reason, claimed_at, outcome)
         VALUES (@id, @occurrenceId, @alertSequence, @kind, @presentation, @batchId, @reason, @claimedAt, 'claimed')`,
      )
      .run(d);
  }

  /** Records a dispatch result on deliveries that are still only claimed. */
  setOutcome(deliveryIds: readonly string[], outcome: Exclude<DeliveryRecordOutcome, 'claimed'>, dispatchedAt: number | null, detail: string | null): void {
    this.db
      .prepare<[string, number | null, string | null, string]>(
        "UPDATE alert_deliveries SET outcome = ?, dispatched_at = ?, detail = ? WHERE id IN (SELECT value FROM json_each(?)) AND outcome = 'claimed'",
      )
      .run(outcome, dispatchedAt, detail, json(deliveryIds));
  }

  /** Claims left by a previous run that may or may not have been shown: never sent again (INF-SCHED-03). */
  markStaleClaimsUncertain(): number {
    return this.db.prepare("UPDATE alert_deliveries SET outcome = 'uncertain', detail = 'claimed-before-restart' WHERE outcome = 'claimed'").run().changes;
  }

  getDelivery(id: string): DeliveryRow | undefined {
    return this.db.prepare<[string], DeliveryRow>('SELECT * FROM alert_deliveries WHERE id = ?').get(id);
  }

  deliveriesOfBatch(batchId: string): DeliveryRow[] {
    return this.db.prepare<[string], DeliveryRow>('SELECT * FROM alert_deliveries WHERE batch_id = ? ORDER BY claimed_at, id').all(batchId);
  }

  /** Records a click or a close of the notification; neither changes the occurrence (INF-REM-08). */
  markDeliveries(ids: readonly string[], column: 'clicked_at' | 'closed_at', at: number): void {
    this.db
      .prepare<[number, string]>(`UPDATE alert_deliveries SET ${column} = ? WHERE id IN (SELECT value FROM json_each(?)) AND ${column} IS NULL`)
      .run(at, json(ids));
  }
}
