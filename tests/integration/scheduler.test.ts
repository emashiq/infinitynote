import { describe, expect, it } from 'vitest';
import { RemindersRepo } from '../../src/main/db/repositories/reminders-repo';
import { TIMER_CAP_MS } from '../../src/main/services/reminder-scheduler';
import { overdueText, type ReminderCreateRequestType } from '../../src/shared/contracts/reminders';
import { HOUR, MINUTE, T0, at, reminderInput, setupScheduler, settle, updateRequest } from './reminder-helpers';

const iso = (ms: number) => new Date(ms).toISOString();
/** A one-time reminder in UTC at an instant (keeps the arithmetic of the timing tests obvious). */
const utc = (noteId: string, instant: number, over: Partial<ReminderCreateRequestType> = {}) =>
  reminderInput(noteId, { zoneId: 'UTC', date: iso(instant).slice(0, 10), time: iso(instant).slice(11, 16), ...over });

async function withNote(opts: Parameters<typeof setupScheduler>[0] = {}) {
  const s = await setupScheduler(opts);
  const note = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Quarterly').note;
  return { s, note };
}

describe('scheduler: initial alert (INF-REM-06)', () => {
  it('nothing before the due instant, one notification at it, recorded as a dispatched initial delivery', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(reminderInput(note.id));
    await s.start();
    await s.advance(at('2026-10-09T10:59:59.999Z') - s.clock.now());
    expect(s.adapter.shown()).toEqual([]);
    await s.advance(1);
    expect(s.adapter.shown()).toEqual([{ id: 1, ref: expect.any(String), title: 'Submit report', body: 'Due Fri 9 Oct, 17:00 · Quarterly', at: at('2026-10-09T11:00:00Z') }]);
    expect(s.deliveries()).toEqual([
      expect.objectContaining({ alert_sequence: 0, kind: 'initial', presentation: 'single', reason: 'timer', outcome: 'dispatched', dispatched_at: at('2026-10-09T11:00:00Z') }),
    ]);
    expect(s.occurrence(dto.current!.occurrenceId)).toMatchObject({ alert_sequence: 1, next_alert_at_utc: null, state: 'pending' });
    expect(s.reminders.listView('overdue', { kind: 'all' }).items.map((i) => i.occurrenceId)).toEqual([dto.current!.occurrenceId]);
    expect(s.reminders.listView('overdue', { kind: 'all' }).items[0]).toMatchObject({ alertsSent: 1, lastOutcome: 'dispatched' });
    expect(s.changed).toContainEqual({ reason: 'alerted', noteIds: [note.id] });
    expect(s.alerts).toEqual([]);
    expect(s.attention()).toBe(0);
  });
});

describe('scheduler: close is not done (INF-REM-08)', () => {
  it('closing the notification records closed_at and changes nothing else', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + 5 * MINUTE));
    await s.start();
    await s.advance(5 * MINUTE);
    s.adapter.close(1);
    expect(s.deliveries()[0]).toMatchObject({ closed_at: T0 + 5 * MINUTE, clicked_at: null });
    expect(s.occurrence(dto.current!.occurrenceId)).toMatchObject({ state: 'pending', completed_at: null });
    expect(s.reminders.listView('overdue', { kind: 'all' }).items).toHaveLength(1);
    expect(s.changed.some((e) => e.reason === 'completed')).toBe(false);
  });

  it('clicking opens the source note and its block, and is recorded (INF-REM-07)', async () => {
    const { s } = await withNote();
    const n = s.editable('Source');
    const B = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
    n.save({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: B }, content: [{ type: 'text', text: 'Pay rent' }] }] });
    s.reminders.create(utc(n.note.id, T0 + MINUTE, { blockId: B }));
    await s.start();
    await s.advance(MINUTE);
    s.adapter.click(1);
    expect(s.opened).toEqual([{ noteId: n.note.id, blockId: B }]);
    expect(s.deliveries()[0]!.clicked_at).toBe(T0 + MINUTE);
  });
});

describe('scheduler: done stops follow-ups (INF-REM-09)', () => {
  it('Done after the first alert stops every follow-up', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + 5 * MINUTE, { followup: { intervalMinutes: 5, maxFollowups: 3 } }));
    await s.start();
    await s.advance(5 * MINUTE);
    expect(s.adapter.shown()).toHaveLength(1);
    await s.advance(MINUTE);
    s.reminders.complete(dto.current!.occurrenceId);
    expect(s.occurrence(dto.current!.occurrenceId)).toMatchObject({ state: 'completed', next_alert_at_utc: null });
    await s.advance(30 * MINUTE);
    expect(s.adapter.shown()).toHaveLength(1);
  });

  it('completing today’s occurrence of a daily series leaves tomorrow’s with its own due time', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + 10 * MINUTE, { recurrence: { freq: 'daily' } }));
    await s.start();
    await s.advance(10 * MINUTE);
    s.reminders.complete(dto.current!.occurrenceId);
    const open = s.occurrences(dto.id).filter((o) => o.state === 'pending');
    expect(open.map((o) => o.due_at_utc)).toEqual([T0 + 10 * MINUTE + 24 * HOUR]);
  });
});

describe('scheduler: snooze race (INF-REM-10)', () => {
  it('(a) a snooze that lands after the tick read the occurrence wins: no delivery, then one snooze alert', async () => {
    let onClaim: ((id: string) => void) | null = null;
    const { s, note } = await withNote({ testHooks: { beforeClaim: (id) => onClaim?.(id) } });
    onClaim = (id) => {
      onClaim = null;
      s.reminders.snooze(id, 10);
    };
    const dto = s.reminders.create(utc(note.id, T0 + MINUTE));
    await s.start();
    await s.advance(MINUTE);
    expect(s.deliveries()).toEqual([]);
    expect(s.adapter.shown()).toEqual([]);
    expect(s.occurrence(dto.current!.occurrenceId)).toMatchObject({ state: 'snoozed', next_alert_at_utc: T0 + 11 * MINUTE });
    await s.advance(10 * MINUTE);
    expect(s.adapter.shown()).toHaveLength(1);
    expect(s.deliveries()).toEqual([expect.objectContaining({ kind: 'snooze', alert_sequence: 0, outcome: 'dispatched' })]);
  });

  it('(b) a snooze while the notification is still being shown keeps the snooze; the delivery records the outcome', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + MINUTE));
    s.adapter.mode = 'hang';
    await s.start();
    await s.advance(MINUTE);
    expect(s.deliveries()[0]!.outcome).toBe('claimed');
    s.reminders.snooze(dto.current!.occurrenceId, 15);
    s.adapter.release();
    await settle();
    expect(s.deliveries()[0]).toMatchObject({ outcome: 'dispatched' });
    expect(s.occurrence(dto.current!.occurrenceId)).toMatchObject({ state: 'snoozed', snoozed_until_utc: T0 + 16 * MINUTE, next_alert_at_utc: T0 + 16 * MINUTE });
  });

  it('(c) a snooze replaces pending follow-ups; the cadence restarts after the snooze alert', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + MINUTE, { followup: { intervalMinutes: 5, maxFollowups: 2 } }));
    const occ = dto.current!.occurrenceId;
    const T = T0 + MINUTE;
    await s.start();
    await s.advance(MINUTE);
    await s.advance(MINUTE);
    s.reminders.snooze(occ, 15);
    await s.advance(T + 16 * MINUTE - s.clock.now() - 1);
    expect(s.adapter.shown().map((n) => n.at)).toEqual([T]);
    await s.advance(1);
    await s.advance(5 * MINUTE);
    expect(s.adapter.shown().map((n) => n.at)).toEqual([T, T + 16 * MINUTE, T + 21 * MINUTE]);
    expect(s.deliveries().map((d) => d.kind)).toEqual(['initial', 'snooze', 'followup']);
    expect(s.occurrence(occ)).toMatchObject({ followups_sent: 1, next_alert_at_utc: T + 26 * MINUTE });
  });

  it('(d) snoozing today’s occurrence of a daily series does not move tomorrow’s', async () => {
    const { s, note } = await withNote({ now: at('2026-10-08T12:59:00Z') });
    const dto = s.reminders.create(reminderInput(note.id, { zoneId: 'America/New_York', date: '2026-10-08', time: '09:00', recurrence: { freq: 'daily' } }));
    await s.start();
    await s.advance(MINUTE);
    const today = s.occurrences(dto.id).find((o) => o.due_at_utc === at('2026-10-08T13:00:00Z'))!;
    s.reminders.snooze(today.id, 60);
    expect(s.occurrences(dto.id).map((o) => [iso(o.due_at_utc), o.state])).toEqual([
      ['2026-10-08T13:00:00.000Z', 'snoozed'],
      ['2026-10-09T13:00:00.000Z', 'pending'],
    ]);
  });

  it('(e) Tomorrow 09:00 is the next calendar day in the reminder zone, not the display zone', async () => {
    const { s, note } = await withNote();
    // Due 2026-10-07 23:00 New York (03:00Z); at T0 it is 03:00 on 8 October in New York and 13:00 in Dhaka.
    const dto = s.reminders.create(reminderInput(note.id, { zoneId: 'America/New_York', date: '2026-10-07', time: '23:00', allowPast: true }));
    expect(s.reminders.snooze(dto.current!.occurrenceId, 'tomorrow').snoozedUntilUtc).toBe(at('2026-10-09T13:00:00Z'));
  });
});

describe('scheduler: follow-up limit (INF-REM-11)', () => {
  it('15 minutes twice: alerts at T, T+15, T+30 and none after', async () => {
    const { s, note } = await withNote();
    const T = T0 + MINUTE;
    const dto = s.reminders.create(utc(note.id, T, { followup: { intervalMinutes: 15, maxFollowups: 2 } }));
    await s.start();
    await s.advance(61 * MINUTE);
    expect(s.adapter.shown().map((n) => n.at)).toEqual([T, T + 15 * MINUTE, T + 30 * MINUTE]);
    expect(s.deliveries().map((d) => [d.alert_sequence, d.kind])).toEqual([
      [0, 'initial'],
      [1, 'followup'],
      [2, 'followup'],
    ]);
    expect(s.occurrence(dto.current!.occurrenceId)).toMatchObject({ followups_sent: 2, next_alert_at_utc: null, alert_sequence: 3 });
  });
});

describe('scheduler: editing follow-ups after an alert (INF-REM-11, INF-REM-13, QA5-01)', () => {
  /** Changes only the follow-up settings of a one-time reminder due at T0 + 1 minute in UTC. */
  const editFollowup = (s: Awaited<ReturnType<typeof withNote>>['s'], reminderId: string, followup: ReminderCreateRequestType['followup']) => {
    const { revision } = s.reminders.listForNote(s.reminders.source(reminderId).noteId).reminders.find((r) => r.id === reminderId)!;
    return s.reminders.update(updateRequest(reminderId, revision, utc(s.reminders.source(reminderId).noteId, T0 + MINUTE, { followup })));
  };

  it('turning follow-ups off after the first alert cancels the pending follow-up', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + MINUTE, { followup: { intervalMinutes: 5, maxFollowups: 3 } }));
    await s.start();
    await s.advance(MINUTE);
    expect(s.adapter.shown()).toHaveLength(1);
    editFollowup(s, dto.id, null);
    expect(s.occurrence(dto.current!.occurrenceId)).toMatchObject({ state: 'pending', next_alert_at_utc: null, alert_sequence: 1 });
    await s.advance(HOUR);
    expect(s.adapter.shown()).toHaveLength(1);
    expect(s.deliveries().map((d) => d.kind)).toEqual(['initial']);
    expect(s.reminders.listView('overdue', { kind: 'all' }).items.map((i) => i.occurrenceId)).toEqual([dto.current!.occurrenceId]);
  });

  it('lowering the maximum below the follow-ups already sent stops them', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + MINUTE, { followup: { intervalMinutes: 5, maxFollowups: 5 } }));
    await s.start();
    await s.advance(11 * MINUTE);
    expect(s.adapter.shown()).toHaveLength(3);
    editFollowup(s, dto.id, { intervalMinutes: 5, maxFollowups: 1 });
    await s.advance(HOUR);
    expect(s.adapter.shown()).toHaveLength(3);
    expect(s.occurrence(dto.current!.occurrenceId)).toMatchObject({ followups_sent: 2, next_alert_at_utc: null });
  });

  it('a new interval counts from the last alert; a raised maximum continues; switching back on resumes', async () => {
    const { s, note } = await withNote();
    const T = T0 + MINUTE;
    const dto = s.reminders.create(utc(note.id, T, { followup: { intervalMinutes: 5, maxFollowups: 1 } }));
    await s.start();
    await s.advance(3 * MINUTE);
    editFollowup(s, dto.id, { intervalMinutes: 15, maxFollowups: 2 });
    expect(s.occurrence(dto.current!.occurrenceId).next_alert_at_utc).toBe(T + 15 * MINUTE);
    await s.advance(30 * MINUTE);
    expect(s.adapter.shown().map((n) => n.at)).toEqual([T, T + 15 * MINUTE, T + 30 * MINUTE]);
    editFollowup(s, dto.id, null);
    await s.advance(10 * MINUTE);
    // Back on with a higher maximum: the follow-up that is already late fires at once, then the limit holds.
    const resumedAt = s.clock.now();
    editFollowup(s, dto.id, { intervalMinutes: 5, maxFollowups: 3 });
    await settle();
    await s.advance(HOUR);
    expect(s.adapter.shown().map((n) => n.at)).toEqual([T, T + 15 * MINUTE, T + 30 * MINUTE, resumedAt]);
    expect(s.occurrence(dto.current!.occurrenceId)).toMatchObject({ followups_sent: 3, next_alert_at_utc: null });
  });

  it('a snoozed occurrence keeps its snooze alert when follow-ups are switched off', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + MINUTE, { followup: { intervalMinutes: 5, maxFollowups: 3 } }));
    await s.start();
    await s.advance(MINUTE);
    const until = s.reminders.snooze(dto.current!.occurrenceId, 10).snoozedUntilUtc!;
    editFollowup(s, dto.id, null);
    expect(s.occurrence(dto.current!.occurrenceId)).toMatchObject({ state: 'snoozed', next_alert_at_utc: until });
    await s.advance(HOUR);
    expect(s.deliveries().map((d) => [d.kind, d.claimed_at])).toEqual([
      ['initial', T0 + MINUTE],
      ['snooze', until],
    ]);
  });

  it('an edit that lands between the read and the claim of a follow-up wins: the stale claim loses', async () => {
    let hook: (() => void) | null = null;
    const { s, note } = await withNote({ testHooks: { beforeClaim: () => hook?.() } });
    const dto = s.reminders.create(utc(note.id, T0 + MINUTE, { followup: { intervalMinutes: 5, maxFollowups: 3 } }));
    await s.start();
    await s.advance(MINUTE);
    let edited = false;
    hook = () => {
      hook = null;
      editFollowup(s, dto.id, null);
      edited = true;
    };
    await s.advance(HOUR);
    expect(edited).toBe(true);
    expect(s.adapter.shown()).toHaveLength(1);
    expect(s.deliveries()).toHaveLength(1);
  });
});

describe('scheduler: recurrence vs completion (INF-REM-12)', () => {
  it('completing the 03-07 occurrence leaves 03-08 pending at 13:00Z (09:00 EDT)', async () => {
    const { s, note } = await withNote({ now: at('2026-03-07T13:59:00Z') });
    const dto = s.reminders.create(reminderInput(note.id, { zoneId: 'America/New_York', date: '2026-03-07', time: '09:00', recurrence: { freq: 'daily' } }));
    await s.start();
    await s.advance(MINUTE);
    expect(s.adapter.shown()).toHaveLength(1);
    const first = s.occurrences(dto.id)[0]!;
    expect(first.due_at_utc).toBe(at('2026-03-07T14:00:00Z'));
    s.reminders.complete(first.id);
    expect(s.occurrences(dto.id).map((o) => [iso(o.due_at_utc), o.state])).toEqual([
      ['2026-03-07T14:00:00.000Z', 'completed'],
      ['2026-03-08T13:00:00.000Z', 'pending'],
    ]);
  });

  it('a weekly series keeps exactly one future open occurrence after each completion', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(reminderInput(note.id, { date: '2026-10-08', time: '09:00', recurrence: { freq: 'weekly', byWeekday: [1, 3, 5] } }));
    await s.start();
    const dues: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const open = s.occurrences(dto.id).filter((o) => o.state === 'pending' && o.due_at_utc > s.clock.now());
      expect(open).toHaveLength(1);
      dues.push(iso(open[0]!.due_at_utc));
      s.reminders.complete(open[0]!.id);
    }
    expect(dues).toEqual(['2026-10-09T03:00:00.000Z', '2026-10-12T03:00:00.000Z', '2026-10-14T03:00:00.000Z']);
    expect(s.occurrences(dto.id).filter((o) => o.state === 'pending').map((o) => iso(o.due_at_utc))).toEqual(['2026-10-16T03:00:00.000Z']);
  });
});

describe('scheduler: OS zone change (INF-REM-15)', () => {
  it('a new computer zone changes the display and the default, never stored zones or instants', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(reminderInput(note.id, { zoneId: 'America/New_York', date: '2026-10-09', time: '09:00' }));
    await s.start();
    const stored = s.row('SELECT zone_id, start_local_date, local_time FROM reminders WHERE id = ?', dto.id);
    const due = s.occurrences(dto.id)[0]!.due_at_utc;
    s.zones.set('Europe/London');
    s.scheduler().wake('timer');
    await settle();
    expect(s.row('SELECT zone_id, start_local_date, local_time FROM reminders WHERE id = ?', dto.id)).toEqual(stored);
    expect(s.occurrences(dto.id)[0]!.due_at_utc).toBe(due);
    expect(s.reminders.listView('upcoming', { kind: 'all' }).displayZone).toBe('Europe/London');
    expect(s.reminders.zones().defaultZone).toBe('Europe/London');
    s.settings.set('reminders.defaultZone', 'Asia/Dhaka');
    expect(s.reminders.zones().defaultZone).toBe('Asia/Dhaka');
    expect(s.changed.filter((e) => e.reason === 'zone')).toEqual([{ reason: 'zone', noteIds: [] }]);
    expect(s.logger.lines).toContain('INFO reminders: system zone Asia/Dhaka -> Europe/London');
  });
});

describe('scheduler: user action while a batch is being shown (INF-REM-09, INF-REM-10, QA5-02)', () => {
  it('Done or Snooze on a claimed sibling before its notification: never shown, recorded as skipped, no in-app alert', async () => {
    const { s, note } = await withNote();
    const [a, b, c] = ['A', 'B', 'C'].map((title) => s.reminders.create(utc(note.id, T0 + MINUTE, { title })).current!.occurrenceId);
    s.adapter.mode = 'hang';
    await s.start();
    await s.advance(MINUTE);
    // Alerts of one instant go out in creation order; A waits for its show confirmation, B and C are claimed only.
    expect(s.adapter.shown().map((n) => n.title)).toEqual(['A']);
    expect(s.deliveries()).toHaveLength(3);
    s.reminders.complete(b!);
    const until = s.reminders.snooze(c!, 10).snoozedUntilUtc!;
    s.adapter.mode = 'ok';
    s.adapter.release();
    await settle();
    expect(s.adapter.shown().map((n) => n.title)).toEqual(['A']);
    const of = (occurrenceId: string) => s.deliveries().filter((d) => d.occurrence_id === occurrenceId);
    expect(of(a!)).toEqual([expect.objectContaining({ outcome: 'dispatched' })]);
    expect(of(b!)).toEqual([expect.objectContaining({ outcome: 'skipped', detail: 'superseded-before-dispatch', dispatched_at: null })]);
    expect(of(c!)).toEqual([expect.objectContaining({ outcome: 'skipped' })]);
    expect(s.alerts).toEqual([]);
    expect(s.attention()).toBe(0);
    expect(s.reminders.listView('overdue', { kind: 'all' }).items.map((i) => [i.title, i.lastOutcome])).toEqual([['A', 'dispatched']]);
    // A skipped claim reports no notification outcome.
    expect(s.reminders.itemsOf([c!])[0]).toMatchObject({ state: 'snoozed', lastOutcome: null });
    await s.advance(until - s.clock.now());
    expect(s.adapter.shown().map((n) => [n.title, n.at])).toEqual([
      ['A', T0 + MINUTE],
      ['C', until],
    ]);
  });
});

describe('scheduler: adapter failure (INF-SCHED-04)', () => {
  it('failed: recorded with detail, in-app alert and attention', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + MINUTE));
    s.adapter.mode = 'fail';
    await s.start();
    await s.advance(MINUTE);
    expect(s.deliveries()[0]).toMatchObject({ outcome: 'failed', detail: 'test failure', dispatched_at: null });
    expect(s.alerts).toEqual([{ batchId: expect.any(String), outcome: 'failed', presentation: 'single', total: 1, items: [expect.objectContaining({ occurrenceId: dto.current!.occurrenceId, lastOutcome: 'failed', overdue: true })] }]);
    expect(s.attention()).toBe(1);
    expect(s.occurrence(dto.current!.occurrenceId).state).toBe('pending');
  });

  it('unsupported: the adapter is never called', async () => {
    const { s, note } = await withNote({ capability: { status: 'unsupported', reason: 'no-notification-server' } });
    s.reminders.create(utc(note.id, T0 + MINUTE));
    await s.start();
    await s.advance(MINUTE);
    expect(s.adapter.shown()).toEqual([]);
    expect(s.deliveries()[0]).toMatchObject({ outcome: 'unsupported', detail: 'no-notification-server' });
    expect(s.alerts.map((a) => a.outcome)).toEqual(['unsupported']);
  });

  it('hang: uncertain after 3000 ms; throw: failed', async () => {
    const { s, note } = await withNote();
    s.reminders.create(utc(note.id, T0 + MINUTE));
    s.reminders.create(utc(note.id, T0 + 2 * MINUTE, { title: 'Second' }));
    s.adapter.mode = 'hang';
    await s.start();
    await s.advance(MINUTE + 2_999);
    expect(s.deliveries().map((d) => d.outcome)).toEqual(['claimed']);
    await s.advance(1);
    expect(s.deliveries().map((d) => [d.outcome, d.detail])).toEqual([['uncertain', 'no-show-event']]);
    s.adapter.mode = 'throw';
    await s.advance(MINUTE);
    expect(s.deliveries().map((d) => [d.outcome, d.detail])).toEqual([
      ['uncertain', 'no-show-event'],
      ['failed', 'Notification threw'],
    ]);
    expect(s.alerts.map((a) => a.outcome)).toEqual(['uncertain', 'failed']);
  });
});

describe('scheduler: quiet hours (INF-SCHED-06)', () => {
  it('alerts in quiet hours wait for the end, collapsed to one per occurrence, and stay overdue meanwhile', async () => {
    const { s, note } = await withNote();
    s.settings.set('reminders.quietHours', { enabled: true, start: '22:00', end: '07:00', zoneId: 'Asia/Dhaka' });
    const followup = { intervalMinutes: 15 as const, maxFollowups: 2 as const };
    const a = s.reminders.create(reminderInput(note.id, { date: '2026-10-08', time: '22:30', followup }));
    const b = s.reminders.create(reminderInput(note.id, { date: '2026-10-08', time: '23:00', followup, title: 'Second' }));
    await s.start();
    const end = at('2026-10-09T01:00:00Z');
    await s.advance(end - s.clock.now() - 1);
    expect(s.adapter.shown()).toEqual([]);
    expect(s.occurrence(a.current!.occurrenceId).next_alert_at_utc).toBe(end);
    expect(s.occurrence(b.current!.occurrenceId).next_alert_at_utc).toBe(end);
    expect(s.reminders.listView('overdue', { kind: 'all' }).items.map((i) => i.title)).toEqual(['Submit report', 'Second']);
    await s.advance(1);
    expect(s.adapter.shown().map((n) => [n.title, n.at])).toEqual([
      ['Submit report', end],
      ['Second', end],
    ]);
    expect(s.deliveries().map((d) => [d.kind, d.reason])).toEqual([
      ['initial', 'quiet_end'],
      ['initial', 'quiet_end'],
    ]);
    await s.advance(31 * MINUTE);
    expect(s.adapter.shown().filter((n) => n.title === 'Submit report').map((n) => n.at)).toEqual([end, end + 15 * MINUTE, end + 30 * MINUTE]);
  });
});

describe('scheduler: single timer (INF-SCHED-01)', () => {
  it('one timer, capped at 60 s, re-armed after every kind of write', async () => {
    const { s, note } = await withNote();
    await s.start();
    expect(s.timers.live()).toBe(1);
    expect(s.scheduler().timerState()).toEqual({ armed: true, delayMs: TIMER_CAP_MS });
    const first = s.reminders.create(utc(note.id, T0 + 5 * MINUTE));
    s.reminders.create(utc(note.id, T0 + 2 * HOUR));
    s.reminders.create(utc(note.id, T0 + 3 * HOUR));
    await settle();
    expect(s.timers.live()).toBe(1);
    expect(s.scheduler().timerState().delayMs).toBe(TIMER_CAP_MS);
    await s.advance(4.5 * MINUTE);
    s.reminders.create(utc(note.id, T0 + 4 * HOUR));
    await settle();
    expect(s.scheduler().timerState()).toEqual({ armed: true, delayMs: 30_000 });
    await s.advance(30_000);
    s.reminders.complete(first.current!.occurrenceId);
    await settle();
    expect(s.timers.live()).toBe(1);
    s.settings.set('reminders.quietHours', { enabled: false, start: '22:00', end: '07:00', zoneId: null });
    s.scheduler().wake('settings');
    s.trash.trashNote(s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'x').note.id);
    s.scheduler().wake('restore');
    await settle();
    expect(s.timers.live()).toBe(1);
  });

  it('1,000 reminders: still one timer, and the next-alert query uses its partial index', async () => {
    const { s } = await withNote();
    const notes = Array.from({ length: 5 }, (_, i) => s.hierarchy.createNote({ projectId: null, folderId: null }, false, `n${i}`).note.id);
    for (let i = 0; i < 1000; i += 1) s.reminders.create(utc(notes[i % 5]!, T0 + (i + 1) * MINUTE));
    await s.start();
    expect(s.count('occurrences')).toBe(1000);
    expect(s.timers.live()).toBe(1);
    const plan = s.rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${RemindersRepo.MIN_NEXT_ALERT_SQL}`).map((r) => r.detail).join(' | ');
    expect(plan).toContain('occurrences_next_alert');
    await s.advance(10 * MINUTE);
    expect(s.adapter.shown()).toHaveLength(10);
    expect(s.timers.live()).toBe(1);
  });

  it('1,000 overdue at a resume: one summary naming all 1,000, in one batch (QA5-03)', async () => {
    const { s } = await withNote();
    const notes = Array.from({ length: 5 }, (_, i) => s.hierarchy.createNote({ projectId: null, folderId: null }, false, `n${i}`).note.id);
    await s.start();
    for (let i = 0; i < 1000; i += 1) s.reminders.create(utc(notes[i % 5]!, T0 + 5 * MINUTE, { title: `R${i}` }));
    s.clock.set(T0 + HOUR);
    s.power.emit('resume');
    await settle();
    await s.advance(3 * MINUTE);
    expect(s.adapter.shown().map((n) => n.body)).toEqual([overdueText(1000)]);
    const deliveries = s.deliveries();
    expect(deliveries).toHaveLength(1000);
    expect(new Set(deliveries.map((d) => d.batch_id)).size).toBe(1);
    expect(deliveries.every((d) => d.presentation === 'summary' && d.outcome === 'dispatched' && d.reason === 'resume')).toBe(true);
    expect(s.reminders.summary({ kind: 'all' }).overdueTotal).toBe(1000);
  });

  it('a due alert on a trashed note does not drive the timer; a stuck claim backs off instead of looping', async () => {
    let failClaims = false;
    const { s, note } = await withNote({
      testHooks: {
        duringClaim: () => {
          if (failClaims) throw new Error('claim fault');
        },
      },
    });
    const trashed = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Trashed').note;
    s.reminders.create(utc(trashed.id, T0 + MINUTE));
    s.reminders.create(utc(note.id, T0 + 10 * MINUTE));
    s.trash.trashNote(trashed.id);
    await s.start();
    await s.advance(5 * MINUTE);
    expect(s.scheduler().timerState().delayMs).toBe(TIMER_CAP_MS);
    // A tick 30 s before the live reminder aims at it; the trashed one (due long ago) would have meant 0 ms.
    await s.advance(4 * MINUTE + 30_000);
    s.scheduler().wake('timer');
    await settle();
    expect(s.scheduler().timerState().delayMs).toBe(30_000);
    failClaims = true;
    const delays: number[] = [];
    await s.advance(30_000);
    for (let i = 0; i < 10; i += 1) {
      const { delayMs } = s.scheduler().timerState();
      delays.push(delayMs!);
      await s.advance(delayMs!);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000, 60_000]);
    expect(s.logger.lines.filter((l) => l.includes('backing off'))).toHaveLength(1);
    failClaims = false;
    await s.advance(60_000);
    expect(s.adapter.shown()).toHaveLength(1);
    expect(s.scheduler().timerState().delayMs).toBe(TIMER_CAP_MS);
  });
});
