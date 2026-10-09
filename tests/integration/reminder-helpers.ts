import { randomUUID } from 'node:crypto';
import type { CapabilityStatusType } from '../../src/shared/contracts/app';
import type { ReminderAlertEventType, ReminderChangedEventType, ReminderCreateRequestType } from '../../src/shared/contracts/reminders';
import { createFakeClock, type FakeClock } from '../../src/main/services/clock';
import { capabilityGate, createFakeNotificationAdapter } from '../../src/main/services/notification-adapter';
import { createFakePowerEvents } from '../../src/main/services/power-events';
import { ReminderScheduler, type SchedulerTestHooks } from '../../src/main/services/reminder-scheduler';
import { setupServices } from './hierarchy-helpers';

/** The reference instant of the Phase 05 tests: 2026-10-08 13:00 in Asia/Dhaka (plan section 12.1). */
export const T0 = Date.parse('2026-10-08T07:00:00Z');
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const at = (iso: string): number => Date.parse(iso);

const WC = 7;

export const para = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: text ? [{ type: 'text', text }] : undefined });
export const doc = (...blocks: unknown[]) => ({ type: 'doc' as const, content: blocks });

/** A one-time request with the plan's defaults (Submit report, Asia/Dhaka, 2026-10-09 17:00). */
export function reminderInput(noteId: string, over: Partial<ReminderCreateRequestType> = {}): ReminderCreateRequestType {
  return {
    noteId,
    blockId: null,
    title: 'Submit report',
    zoneId: 'Asia/Dhaka',
    date: '2026-10-09',
    time: '17:00',
    recurrence: null,
    foldPreference: 'earlier',
    followup: null,
    allowPast: false,
    ...over,
  };
}

/** The production services at T0 with the computer zone Asia/Dhaka, plus an editable note helper. */
export async function setupReminders(opts: { now?: number; zone?: string | null } = {}) {
  const s = await setupServices({ clock: createFakeClock(opts.now ?? T0), zone: opts.zone });

  /** A note this test edits through the real save path (lease, writer, conversions and version restores). */
  function editable(title: string, format: 'rich' | 'plain' = 'rich') {
    const note = s.hierarchy.createNote({ projectId: null, folderId: null }, false, title, format).note;
    const viewId = randomUUID();
    const lease = s.leases.acquire(note.id, viewId, WC);
    if (!lease.granted) throw new Error('lease');
    let revision = 0;
    const op = () => ({ noteId: note.id, viewId, leaseToken: lease.leaseToken, baseRevision: revision, requestId: randomUUID() });
    return {
      note,
      save(content: unknown) {
        const f = typeof content === 'string' ? 'plain' : 'rich';
        revision = s.writer.save({ ...op(), format: f, content } as never, { webContentsId: WC }).revision;
        return revision;
      },
      convert(targetFormat: 'rich' | 'plain') {
        const res = s.formats.convert({ ...op(), targetFormat, ...(targetFormat === 'plain' ? { confirmLossy: true as const } : {}) } as never, { webContentsId: WC });
        revision = res.revision;
        return res;
      },
      restore(versionId: string) {
        revision = s.versions.restore({ ...op(), versionId }, { webContentsId: WC }).revision;
      },
      revision: () => revision,
    };
  }

  const count = (table: 'reminders' | 'occurrences' | 'alert_deliveries') => s.row<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)!.n;
  const occurrences = (reminderId: string) =>
    s.rows<{ id: string; due_at_utc: number; state: string; next_alert_at_utc: number | null; original_local_date_time: string; completed_at: number | null }>(
      'SELECT id, due_at_utc, state, next_alert_at_utc, original_local_date_time, completed_at FROM occurrences WHERE reminder_id = ? ORDER BY due_at_utc',
      reminderId,
    );
  return { ...s, editable, count, occurrences };
}

/**
 * Timers driven by the test clock's monotonic time, like Node's timers (a wall-clock jump does not move them): a fire
 * happens only when `advance` reaches it. Counts live timers (INF-SCHED-01).
 */
export function manualTimers(clock: { monotonicNow(): number }) {
  const live = new Map<number, { at: number; fn: () => void; ms: number }>();
  let seq = 0;
  return {
    setTimeout(fn: () => void, ms: number): unknown {
      seq += 1;
      live.set(seq, { at: clock.monotonicNow() + ms, fn, ms });
      return seq;
    },
    clearTimeout(handle: unknown): void {
      live.delete(handle as number);
    },
    live: () => live.size,
    /** The earliest timer due at or before the monotonic instant `until`, removed from the live set. */
    takeDue(until: number): { at: number; fn: () => void } | null {
      let best: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of live) if (entry[1].at <= until && (!best || entry[1].at < best[1].at)) best = entry;
      if (!best) return null;
      live.delete(best[0]);
      return best[1];
    },
  };
}

/** Lets every queued microtask and immediate run (ticks are synchronous apart from awaiting the adapter). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

export interface SchedulerOptions {
  now?: number;
  zone?: string | null;
  capability?: CapabilityStatusType;
  testHooks?: SchedulerTestHooks;
}

/**
 * The production services plus a ReminderScheduler over a fake notification adapter, fake power events and timers
 * driven by the frozen clock. Reminder writes wake the scheduler like main does.
 */
export async function setupScheduler(opts: SchedulerOptions = {}) {
  const s = await setupReminders({ now: opts.now, zone: opts.zone });
  const clock = s.clock as FakeClock;
  const timers = manualTimers(clock);
  const adapter = createFakeNotificationAdapter(clock, timers);
  const power = createFakePowerEvents();
  const changed: ReminderChangedEventType[] = [];
  const alerts: ReminderAlertEventType[] = [];
  const opened: Array<{ noteId: string; blockId: string | null }> = [];
  const openedViews: string[] = [];
  let attention = 0;
  const capability = opts.capability ?? { status: 'supported', reason: 'test' };
  const make = (hooks?: SchedulerTestHooks) =>
    new ReminderScheduler({
      db: s.t.db,
      clock,
      ids: s.ids,
      logger: s.logger,
      reminders: s.reminders,
      zones: s.zones,
      quietHours: () => s.settings.getInternal('reminders.quietHours'),
      adapter: capabilityGate(adapter, () => capability),
      power,
      emitChanged: (e) => changed.push(e),
      emitAlert: (e) => alerts.push(e),
      requestAttention: () => {
        attention += 1;
      },
      openNote: (noteId, blockId) => opened.push({ noteId, blockId }),
      openReminders: (view) => openedViews.push(view),
      timers,
      testHooks: hooks,
    });
  let scheduler = make(opts.testHooks);
  s.reminderWrites.onWrite = () => scheduler.wake('write');

  /** Lets time pass (wall and monotonic), firing the scheduler's timer whenever it falls due on the way. */
  async function advance(ms: number): Promise<void> {
    const target = clock.monotonicNow() + ms;
    await settle();
    for (let next = timers.takeDue(target); next; next = timers.takeDue(target)) {
      if (next.at > clock.monotonicNow()) clock.advance(next.at - clock.monotonicNow());
      next.fn();
      await settle();
    }
    if (clock.monotonicNow() < target) clock.advance(target - clock.monotonicNow());
    await settle();
  }

  /** Starts the scheduler and lets the startup tick finish. */
  async function start(): Promise<void> {
    scheduler.start();
    await settle();
  }

  /** Drops the running scheduler without any shutdown work (a crash) and starts a new one on the same database. */
  async function restart(hooks?: SchedulerTestHooks): Promise<void> {
    scheduler.stop();
    scheduler = make(hooks);
    await start();
  }

  const deliveries = () =>
    s.rows<{ id: string; occurrence_id: string; alert_sequence: number; kind: string; presentation: string; batch_id: string; reason: string; outcome: string; claimed_at: number; dispatched_at: number | null; detail: string | null; closed_at: number | null; clicked_at: number | null }>(
      'SELECT * FROM alert_deliveries ORDER BY claimed_at, alert_sequence, id',
    );
  const occurrence = (id: string) =>
    s.row<{ state: string; alert_sequence: number; followups_sent: number; next_alert_at_utc: number | null; snoozed_until_utc: number | null; completed_at: number | null; due_at_utc: number }>(
      'SELECT state, alert_sequence, followups_sent, next_alert_at_utc, snoozed_until_utc, completed_at, due_at_utc FROM occurrences WHERE id = ?',
      id,
    )!;

  return {
    ...s,
    clock,
    timers,
    adapter,
    power,
    changed,
    alerts,
    opened,
    openedViews,
    attention: () => attention,
    scheduler: () => scheduler,
    advance,
    start,
    restart,
    deliveries,
    occurrence,
  };
}

/** An update request (no noteId: the reminder names its note) with the plan's default schedule. */
export function updateRequest(reminderId: string, expectedRevision: number, over: Partial<ReminderCreateRequestType> & { pendingPolicy?: 'keep' | 'complete' } = {}) {
  const { noteId: _noteId, ...input } = reminderInput('00000000-0000-4000-8000-000000000000', over);
  return { ...input, reminderId, expectedRevision, pendingPolicy: over.pendingPolicy ?? ('keep' as const) };
}
