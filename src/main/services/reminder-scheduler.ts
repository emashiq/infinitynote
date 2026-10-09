import { overdueText, type ReminderAlertEventType, type ReminderChangedEventType, type ReminderViewType } from '../../shared/contracts/reminders';
import { displayTitle } from '../../shared/names';
import { formatShort } from '../../shared/time/format';
import { quietWindowAt, type QuietHours } from '../../shared/time/quiet-hours';
import type { Db } from '../db/driver';
import { RemindersRepo, type OccurrenceItemRow } from '../db/repositories/reminders-repo';
import { errorDetail } from './app-error';
import type { Clock } from './clock';
import type { IdGenerator } from './ids';
import type { Logger } from './logger';
import type { DeliveryOutcome, NotificationAdapter, NotificationPayload } from './notification-adapter';
import type { PowerEvents } from './power-events';
import type { ReminderService } from './reminder-service';
import type { SystemZoneProvider } from './system-zone';
import { realTimers, type Timers } from './timers';

export const TIMER_CAP_MS = 60_000;
export const CLOCK_JUMP_MS = 120_000;
export const MAX_SINGLE_PER_BATCH = 3;
export const DUE_CHUNK = 500;
/** The notification title of a reminder in a locked note, instead of the reminder title (D-112). */
export const LOCKED_REMINDER_TITLE = 'Reminder in a locked note';
export const BACKOFF_START_MS = 1_000;
const MINUTE = 60_000;

/** Why a tick ran; recorded on each delivery (D-075). */
export type WakeReason = 'timer' | 'startup' | 'resume' | 'clock_jump' | 'quiet_end' | 'restore' | 'write' | 'settings';

/** When several wakes coalesce into one tick, the most specific reason is kept. */
const REASON_RANK: Record<WakeReason, number> = { timer: 0, quiet_end: 1, write: 2, settings: 3, restore: 4, resume: 5, clock_jump: 6, startup: 7 };

/** Integration-test seams for the claim races (plan section 9.5). */
export interface SchedulerTestHooks {
  /** Runs after the due occurrences were read and before each claim (Done or Snooze may land here). */
  beforeClaim?(occurrenceId: string): void;
  /** Runs inside the claim transaction; throwing simulates a crash before the commit. */
  duringClaim?(occurrenceId: string): void;
}

export interface ReminderSchedulerDeps {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  reminders: Pick<ReminderService, 'ensureSeries' | 'itemsOf' | 'occurrenceSource'>;
  zones: SystemZoneProvider;
  quietHours(): QuietHours;
  adapter: NotificationAdapter;
  power: PowerEvents;
  emitChanged(event: ReminderChangedEventType): void;
  /** The in-app fallback when a notification was not confirmed as shown (D-076). */
  emitAlert(event: ReminderAlertEventType): void;
  requestAttention(): void;
  openNote(noteId: string, blockId: string | null): void;
  openReminders(view: ReminderViewType): void;
  timers?: Timers;
  testHooks?: SchedulerTestHooks;
}

interface Claimed {
  deliveryId: string;
  row: OccurrenceItemRow;
}

interface Batch {
  presentation: 'single' | 'summary';
  batchId: string;
  reason: WakeReason;
}

type DispatchResult = { claimed: Claimed[]; outcome: DeliveryOutcome | typeof SUPERSEDED };

/** A claim that Done, Snooze, an edit or a trashed note overtook before it was shown: recorded, never shown. */
const SUPERSEDED = { outcome: 'skipped', detail: 'superseded-before-dispatch' } as const;

/**
 * The single reminder scheduler (D-075, plan section 9.5). One timer is armed for the earliest live next alert (at
 * most 60 s away). Each tick generates series occurrences, defers alerts during quiet hours, claims every due alert in
 * its own transaction (a unique delivery per occurrence and sequence) and only then dispatches: up to 3 alerts are
 * shown one by one, more as one summary that names the tick's total. A crash after a claim can never repeat that
 * alert; the claim becomes `uncertain` at the next start. Done and Snooze always win, both before the claim and
 * between the claim and the notification.
 */
export class ReminderScheduler {
  private readonly repo: RemindersRepo;
  private readonly timers: Timers;
  private timer: { handle: unknown; delayMs: number } | null = null;
  private pending: WakeReason | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  private last: { wall: number; mono: number } | null = null;
  private lastZone: string | null | undefined = undefined;
  private quietEnd: number | null = null;
  private backoffMs = BACKOFF_START_MS;
  private tickCount = 0;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly deps: ReminderSchedulerDeps) {
    this.repo = new RemindersRepo(deps.db);
    this.timers = deps.timers ?? realTimers;
  }

  /** Marks claims of a previous run uncertain, listens to power and notification events and runs the startup tick. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const stale = this.deps.db.transaction(() => this.repo.markStaleClaimsUncertain(), 'immediate');
    if (stale > 0) this.deps.logger.warn(`reminders: stale claims marked uncertain count=${stale}`);
    this.unsubscribers.push(
      this.deps.power.on('resume', () => this.wake('resume')),
      this.deps.power.on('unlock-screen', () => this.wake('resume')),
      this.deps.adapter.onClick((ref) => this.onClicked(ref)),
      this.deps.adapter.onClose((ref) => this.onClosed(ref)),
    );
    this.wake('startup');
  }

  /** Clears the timer and the listeners; later wakes are ignored. */
  stop(): void {
    this.stopped = true;
    this.disarm();
    for (const off of this.unsubscribers.splice(0)) off();
  }

  /** Asks for a tick soon; wakes in one task coalesce into one tick. */
  wake(reason: WakeReason): void {
    if (this.stopped) return;
    if (this.pending === null || REASON_RANK[reason] > REASON_RANK[this.pending]) this.pending = reason;
    if (this.running) return;
    this.running = (async () => {
      await Promise.resolve();
      while (this.pending !== null && !this.stopped) {
        const next = this.pending;
        this.pending = null;
        await this.tick(next);
      }
    })().finally(() => {
      this.running = null;
    });
  }

  /** Resolves when no tick is running or waiting (E2E hooks and tests). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  ticks(): number {
    return this.tickCount;
  }

  timerState(): { armed: boolean; delayMs: number | null } {
    return { armed: this.timer !== null, delayMs: this.timer?.delayMs ?? null };
  }

  // Tick ----------------------------------------------------------------------------------
  private async tick(requested: WakeReason): Promise<void> {
    this.tickCount += 1;
    let progress = false;
    try {
      progress = await this.run(requested);
    } catch (err) {
      this.deps.logger.error(`reminders: tick failed ${errorDetail(err)}`);
    }
    if (!this.stopped) this.arm(progress);
  }

  /** One tick; returns whether it claimed or deferred anything. */
  private async run(requested: WakeReason): Promise<boolean> {
    const { clock, logger } = this.deps;
    const now = clock.now();
    let reason = this.detectJump(requested, now, clock.monotonicNow());
    this.checkZone();
    const generated = this.tx(() => this.deps.reminders.ensureSeries(now));

    let firstPage: OccurrenceItemRow[] = [];
    let deferred = 0;
    const quiet = quietWindowAt(now, this.deps.quietHours());
    if (quiet) {
      deferred = this.tx(() => this.repo.deferDue(now, quiet.endUtc));
      this.quietEnd = quiet.endUtc;
    } else {
      firstPage = this.repo.dueForAlert(now, DUE_CHUNK);
      if (this.quietEnd !== null && this.quietEnd <= now) {
        if (reason === 'timer') reason = 'quiet_end';
        this.quietEnd = null;
      }
    }

    // A page holds far more than MAX_SINGLE_PER_BATCH rows, so the first page decides the presentation.
    const presentation = firstPage.length > MAX_SINGLE_PER_BATCH ? 'summary' : 'single';
    const batchId = this.deps.ids.uuid();
    const { due, claimed } = this.claimDue(now, firstPage, { presentation, batchId, reason });
    if (due > 0 || deferred > 0) {
      logger.info(`reminders: tick reason=${reason} due=${due} claimed=${claimed.length} deferred=${deferred} presentation=${presentation} batch=${batchId}`);
    }
    const touched = [...generated, ...claimed.map((c) => c.row.note_id)];
    if (claimed.length > 0 || deferred > 0) this.deps.emitChanged({ reason: 'alerted', noteIds: [...new Set(touched)] });
    else if (generated.length > 0) this.deps.emitChanged({ reason: 'updated', noteIds: [...new Set(generated)] });
    if (claimed.length > 0) await this.dispatch(claimed, presentation, batchId);
    return claimed.length > 0 || deferred > 0;
  }

  /** A wall-clock change that the monotonic clock did not see is a clock jump (D-075). */
  private detectJump(requested: WakeReason, wall: number, mono: number): WakeReason {
    const last = this.last;
    this.last = { wall, mono };
    if (!last) return requested;
    const drift = wall - last.wall - (mono - last.mono);
    if (Math.abs(drift) <= CLOCK_JUMP_MS) return requested;
    this.deps.logger.info(`reminders: clock jump delta=${drift} direction=${drift > 0 ? 'forward' : 'backward'}`);
    // A forward jump recovers what fell due; a backward jump only reschedules.
    return drift > 0 ? 'clock_jump' : requested;
  }

  /** The computer's zone is read on every wake; a change refreshes the views (stored zones never change, D-079). */
  private checkZone(): void {
    const zone = this.deps.zones.current();
    if (this.lastZone !== undefined && zone !== this.lastZone) {
      this.deps.logger.info(`reminders: system zone ${this.lastZone ?? 'unknown'} -> ${zone ?? 'unknown'}`);
      this.deps.emitChanged({ reason: 'zone', noteIds: [] });
    }
    this.lastZone = zone;
  }

  /** Claims every due alert of this tick, page by page, into one batch. */
  private claimDue(now: number, firstPage: OccurrenceItemRow[], batch: Batch): { due: number; claimed: Claimed[] } {
    const claimed: Claimed[] = [];
    let due = 0;
    for (let page = firstPage; page.length > 0; page = page.length < DUE_CHUNK ? [] : this.repo.dueForAlert(now, DUE_CHUNK, page.at(-1)!)) {
      due += page.length;
      for (const row of page) claimed.push(...this.claim(row, now, batch));
    }
    return { due, claimed };
  }

  private claim(row: OccurrenceItemRow, now: number, batch: Batch): Claimed[] {
    this.deps.testHooks?.beforeClaim?.(row.id);
    const kind = row.state === 'snoozed' ? 'snooze' : row.alert_sequence === 0 ? 'initial' : 'followup';
    const followupsSent = row.followups_sent + (kind === 'followup' ? 1 : 0);
    const interval = row.followup_interval_minutes;
    const nextAlertAtUtc = interval !== null && followupsSent < row.max_followups ? now + interval * MINUTE : null;
    const deliveryId = this.deps.ids.uuid();
    const won = this.tx(() => {
      if (!this.repo.claim({ id: row.id, revision: row.revision, followupsSent, nextAlertAtUtc }, now)) return false;
      this.deps.testHooks?.duringClaim?.(row.id);
      this.repo.insertDelivery({ id: deliveryId, occurrenceId: row.id, alertSequence: row.alert_sequence, kind, ...batch, claimedAt: now });
      return true;
    });
    return won ? [{ deliveryId, row }] : [];
  }

  // Dispatch ----------------------------------------------------------------------------------
  /**
   * Shows the claimed alerts after every claim committed; never inside a transaction. Each notification first re-reads
   * its occurrences, because Done or Snooze may land while an earlier notification of the batch is being shown.
   */
  private async dispatch(claimed: Claimed[], presentation: 'single' | 'summary', batchId: string): Promise<void> {
    const results: DispatchResult[] = [];
    const showCurrent = async (items: Claimed[], payload: (current: Claimed[]) => NotificationPayload) => {
      const alerting = this.repo.stillAlerting(items.map((c) => c.row.id));
      const current = items.filter((c) => alerting.has(c.row.id));
      const superseded = items.filter((c) => !alerting.has(c.row.id));
      if (superseded.length > 0) results.push({ claimed: superseded, outcome: SUPERSEDED });
      if (current.length > 0) results.push({ claimed: current, outcome: await this.show(payload(current)) });
    };
    if (presentation === 'summary') {
      await showCurrent(claimed, (current) => ({ ref: current[0]!.deliveryId, title: 'Infinity Notes', body: overdueText(current.length) }));
    } else {
      for (const c of claimed) {
        const body = `Due ${formatShort(c.row.due_at_utc, c.row.zone_id)} · ${displayTitle(c.row.note_title)}`;
        // A reminder's title may be text from its note; a locked note's reminder says only that it is due (D-112).
        const title = c.row.note_locked === 1 ? LOCKED_REMINDER_TITLE : c.row.title;
        await showCurrent([c], () => ({ ref: c.deliveryId, title, body }));
      }
    }
    const at = this.deps.clock.now();
    this.tx(() => {
      for (const r of results) {
        const ids = r.claimed.map((c) => c.deliveryId);
        this.repo.setOutcome(ids, r.outcome.outcome, r.outcome.outcome === 'dispatched' ? at : null, r.outcome.detail ?? null);
      }
    });
    for (const r of results) for (const c of r.claimed) this.deps.logger.info(`reminders: dispatch delivery=${c.deliveryId} outcome=${r.outcome.outcome}`);

    const missed = results.filter((r): r is { claimed: Claimed[]; outcome: DeliveryOutcome } => r.outcome.outcome !== 'dispatched' && r.outcome.outcome !== 'skipped');
    if (missed.length === 0) return;
    const occurrences = missed.flatMap((r) => r.claimed.map((c) => c.row.id));
    this.deps.emitAlert({
      batchId,
      outcome: missed[0]!.outcome.outcome,
      presentation,
      total: occurrences.length,
      items: this.deps.reminders.itemsOf(occurrences.slice(0, MAX_SINGLE_PER_BATCH)),
    });
    this.deps.requestAttention();
  }

  private async show(payload: NotificationPayload): Promise<DeliveryOutcome> {
    try {
      return await this.deps.adapter.show(payload);
    } catch (err) {
      return { outcome: 'failed', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  // Notification clicks ----------------------------------------------------------------------------------
  /** A click opens the source note (a summary opens Reminders > Overdue) and is recorded (INF-REM-07). */
  private onClicked(deliveryId: string): void {
    const ids = this.markNotification(deliveryId, 'clicked_at');
    if (!ids) return;
    if (ids.summary) {
      this.deps.openReminders('overdue');
      return;
    }
    const source = this.deps.reminders.occurrenceSource(ids.occurrenceId);
    if (source) this.deps.openNote(source.noteId, source.blockId);
  }

  /** Dismissing a notification is recorded and never completes anything (INF-REM-08). */
  private onClosed(deliveryId: string): void {
    this.markNotification(deliveryId, 'closed_at');
  }

  private markNotification(deliveryId: string, column: 'clicked_at' | 'closed_at'): { summary: boolean; occurrenceId: string } | null {
    try {
      const delivery = this.repo.getDelivery(deliveryId);
      if (!delivery) return null;
      const summary = delivery.presentation === 'summary';
      const ids = summary ? this.repo.deliveriesOfBatch(delivery.batch_id).map((d) => d.id) : [delivery.id];
      this.tx(() => this.repo.markDeliveries(ids, column, this.deps.clock.now()));
      return { summary, occurrenceId: delivery.occurrence_id };
    } catch (err) {
      this.deps.logger.error(`reminders: notification ${column} failed ${errorDetail(err)}`);
      return null;
    }
  }

  // Timer ----------------------------------------------------------------------------------
  /**
   * Arms the one timer for the earliest live next alert, at most 60 s away. When something is overdue but the tick made
   * no progress, the delay backs off from 1 s to 60 s, so a stuck row never becomes a busy loop.
   */
  private arm(progress: boolean): void {
    const next = this.repo.minNextAlert();
    let delay = next === null ? TIMER_CAP_MS : Math.min(TIMER_CAP_MS, Math.max(0, next - this.deps.clock.now()));
    if (delay === 0 && !progress) {
      if (this.backoffMs === BACKOFF_START_MS) this.deps.logger.warn('reminders: no progress on a due alert; backing off');
      delay = this.backoffMs;
      this.backoffMs = Math.min(TIMER_CAP_MS, this.backoffMs * 2);
    } else {
      this.backoffMs = BACKOFF_START_MS;
    }
    this.disarm();
    if (delay < TIMER_CAP_MS) this.deps.logger.info(`reminders: timer delay=${delay}`);
    this.timer = { handle: this.timers.setTimeout(() => this.onTimer(), delay), delayMs: delay };
  }

  private onTimer(): void {
    this.timer = null;
    this.wake('timer');
  }

  private disarm(): void {
    if (this.timer) this.timers.clearTimeout(this.timer.handle);
    this.timer = null;
  }

  private tx<T>(fn: () => T): T {
    return this.deps.db.transaction(fn, 'immediate');
  }
}

