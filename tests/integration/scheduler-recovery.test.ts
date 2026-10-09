import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ReminderCreateRequestType } from '../../src/shared/contracts/reminders';
import { DAY, HOUR, MINUTE, T0, reminderInput, setupScheduler, settle } from './reminder-helpers';

const iso = (ms: number) => new Date(ms).toISOString();
const utc = (noteId: string, instant: number, over: Partial<ReminderCreateRequestType> = {}) =>
  reminderInput(noteId, { zoneId: 'UTC', date: iso(instant).slice(0, 10), time: iso(instant).slice(11, 16), ...over });

async function withNote(opts: Parameters<typeof setupScheduler>[0] = {}) {
  const s = await setupScheduler(opts);
  const note = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Recovery').note;
  return { s, note };
}

describe('scheduler recovery: restart around dispatch (INF-SCHED-02)', () => {
  it('a claim left by a crashed run becomes uncertain and is never shown again; the next alert takes the next sequence', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + MINUTE, { followup: { intervalMinutes: 5, maxFollowups: 2 } }));
    s.adapter.mode = 'hang';
    await s.start();
    await s.advance(MINUTE);
    expect(s.deliveries().map((d) => d.outcome)).toEqual(['claimed']);
    // Run A is dropped while its notification hangs; run B starts on the same database.
    s.adapter.mode = 'ok';
    await s.restart();
    expect(s.deliveries()).toEqual([expect.objectContaining({ alert_sequence: 0, outcome: 'uncertain', detail: 'claimed-before-restart' })]);
    expect(s.logger.lines).toContain('WARN reminders: stale claims marked uncertain count=1');
    expect(s.adapter.shown()).toHaveLength(1);
    await s.advance(5 * MINUTE);
    expect(s.adapter.shown()).toHaveLength(2);
    expect(s.deliveries().map((d) => [d.alert_sequence, d.kind, d.outcome])).toEqual([
      [0, 'initial', 'uncertain'],
      [1, 'followup', 'dispatched'],
    ]);
    // The hung show of run A finally times out; it cannot overwrite the recorded outcome.
    await s.advance(5_000);
    expect(s.deliveries()[0]!.outcome).toBe('uncertain');
    expect(s.occurrence(dto.current!.occurrenceId).alert_sequence).toBe(2);
  });

  it('a crash before the claim commits leaves no delivery; the next run alerts once with sequence 0', async () => {
    let crash = true;
    const { s, note } = await withNote({
      testHooks: {
        duringClaim: () => {
          if (crash) throw new Error('crash before commit');
        },
      },
    });
    s.reminders.create(utc(note.id, T0 + MINUTE));
    await s.start();
    await s.advance(MINUTE);
    expect(s.deliveries()).toEqual([]);
    expect(s.adapter.shown()).toEqual([]);
    crash = false;
    await s.restart();
    expect(s.deliveries()).toEqual([expect.objectContaining({ alert_sequence: 0, reason: 'startup', outcome: 'dispatched' })]);
    expect(s.adapter.shown()).toHaveLength(1);
  });

  it('two wakes in one task make one tick and one claim; a duplicate delivery key is refused by the database', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + MINUTE));
    await s.start();
    s.clock.set(T0 + MINUTE);
    const before = s.scheduler().ticks();
    s.scheduler().wake('timer');
    s.scheduler().wake('write');
    await settle();
    expect(s.scheduler().ticks()).toBe(before + 1);
    expect(s.deliveries()).toEqual([expect.objectContaining({ reason: 'write' })]);
    expect(() =>
      s.t.db
        .prepare<[string, string]>(
          "INSERT INTO alert_deliveries(id, occurrence_id, alert_sequence, kind, presentation, batch_id, reason, claimed_at, outcome) VALUES (?, ?, 0, 'initial', 'single', 'b', 'timer', 1, 'claimed')",
        )
        .run(randomUUID(), dto.current!.occurrenceId),
    ).toThrow(/UNIQUE/);
  });
});

describe('scheduler recovery: crash after claim (INF-SCHED-03)', () => {
  it('the occurrence stays overdue and open, with an uncertain last outcome, and is never re-sent', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + MINUTE));
    s.adapter.mode = 'hang';
    await s.start();
    await s.advance(MINUTE);
    s.adapter.mode = 'ok';
    await s.restart();
    const occ = dto.current!.occurrenceId;
    expect(s.occurrence(occ)).toMatchObject({ state: 'pending', completed_at: null, followups_sent: 0, next_alert_at_utc: null });
    const [overdue] = s.reminders.listView('overdue', { kind: 'all' }).items;
    expect(overdue).toMatchObject({ occurrenceId: occ, lastOutcome: 'uncertain', overdue: true, alertsSent: 1 });
    const ticks = s.scheduler().ticks();
    await s.advance(5 * MINUTE);
    expect(s.scheduler().ticks()).toBeGreaterThanOrEqual(ticks + 5);
    expect(s.adapter.shown()).toHaveLength(1);
    expect(s.deliveries()).toHaveLength(1);
  });
});

describe('scheduler recovery: batch limits (INF-SCHED-05)', () => {
  it('3 due at startup: 3 single alerts; 4 due: one summary with 4 deliveries in one batch; then nothing more', async () => {
    for (const n of [3, 4]) {
      const { s, note } = await withNote();
      for (let i = 0; i < n; i += 1) s.reminders.create(utc(note.id, T0 + (i + 1) * MINUTE, { title: `R${i}` }));
      s.clock.set(T0 + HOUR);
      await s.start();
      const deliveries = s.deliveries();
      expect(deliveries).toHaveLength(n);
      expect(new Set(deliveries.map((d) => d.reason))).toEqual(new Set(['startup']));
      expect(new Set(deliveries.map((d) => d.batch_id)).size).toBe(1);
      if (n === 3) {
        expect(s.adapter.shown().map((x) => x.title)).toEqual(['R0', 'R1', 'R2']);
        expect(new Set(deliveries.map((d) => d.presentation))).toEqual(new Set(['single']));
      } else {
        expect(s.adapter.shown().map((x) => [x.title, x.body])).toEqual([['Infinity Notes', '4 reminders are overdue']]);
        expect(new Set(deliveries.map((d) => d.presentation))).toEqual(new Set(['summary']));
        // A click on the summary opens Reminders > Overdue and is recorded on every delivery of the batch.
        s.adapter.click(1);
        expect(s.openedViews).toEqual(['overdue']);
        expect(s.deliveries().every((d) => d.clicked_at === T0 + HOUR)).toBe(true);
      }
      await s.advance(5 * MINUTE);
      expect(s.deliveries()).toHaveLength(n);
    }
  });

  it('resume, forward and backward clock jumps', async () => {
    const { s, note } = await withNote();
    await s.start();
    // Sleep: the timer did not fire; on resume both due reminders alert, reason resume.
    s.reminders.create(utc(note.id, T0 + 10 * MINUTE, { title: 'A' }));
    s.reminders.create(utc(note.id, T0 + 20 * MINUTE, { title: 'B' }));
    await settle();
    s.clock.set(T0 + HOUR);
    s.power.emit('resume');
    await settle();
    expect(s.deliveries().map((d) => d.reason)).toEqual(['resume', 'resume']);
    // A forward wall-clock jump of 2 hours recovers what fell due in between, once per occurrence.
    s.reminders.create(utc(note.id, T0 + 90 * MINUTE, { title: 'C' }));
    s.reminders.create(utc(note.id, T0 + 2 * HOUR, { title: 'D' }));
    await settle();
    s.clock.jump(2 * HOUR);
    await s.advance(MINUTE);
    expect(s.deliveries().slice(2).map((d) => d.reason)).toEqual(['clock_jump', 'clock_jump']);
    expect(s.logger.lines.some((l) => /reminders: clock jump delta=\d+ direction=forward/.test(l))).toBe(true);
    // A backward jump dispatches nothing; the follow-up then takes the next sequence.
    const f = s.reminders.create(utc(note.id, s.clock.now() + MINUTE, { title: 'F', followup: { intervalMinutes: 15, maxFollowups: 2 } }));
    await s.advance(MINUTE);
    const count = s.deliveries().length;
    s.clock.jump(-2 * HOUR);
    await s.advance(MINUTE);
    expect(s.deliveries()).toHaveLength(count);
    expect(s.logger.lines.some((l) => /direction=backward/.test(l))).toBe(true);
    // The wall clock reaches the follow-up (15 min after the first alert) again 2 h 15 min later.
    await s.advance(2 * HOUR + 15 * MINUTE);
    const fd = s.deliveries().filter((d) => d.occurrence_id === f.current!.occurrenceId);
    expect(fd.map((d) => [d.alert_sequence, d.kind])).toEqual([
      [0, 'initial'],
      [1, 'followup'],
    ]);
  });
});

describe('scheduler recovery: long downtime no flood (INF-SCHED-07)', () => {
  it('after 400 days a daily or weekly series gets at most two new rows and alerts once', async () => {
    for (const recurrence of [{ freq: 'daily' as const }, { freq: 'weekly' as const, byWeekday: [4] }]) {
      const { s, note } = await withNote();
      const dto = s.reminders.create(reminderInput(note.id, { date: '2026-10-08', time: '15:00', recurrence }));
      const before = s.occurrences(dto.id).length;
      s.clock.set(T0 + 400 * DAY);
      await s.start();
      const rows = s.occurrences(dto.id);
      expect(rows.length).toBeLessThanOrEqual(before + 2);
      expect(rows.filter((o) => o.state === 'missed')).toHaveLength(before);
      const open = rows.filter((o) => o.state === 'pending');
      expect(open).toHaveLength(2);
      expect(open[0]!.due_at_utc).toBeLessThanOrEqual(s.clock.now());
      expect(open[1]!.due_at_utc).toBeGreaterThan(s.clock.now());
      expect(s.adapter.shown()).toHaveLength(1);
      expect(s.deliveries()).toEqual([expect.objectContaining({ occurrence_id: open[0]!.id, reason: 'startup' })]);
      s.reminders.ensureSeries(s.clock.now());
      s.reminders.ensureSeries(s.clock.now());
      expect(s.occurrences(dto.id)).toHaveLength(rows.length);
    }
  });
});

describe('scheduler recovery: follow-up counts (INF-SCHED-08)', () => {
  it('missed follow-ups are not replayed: one late follow-up, then the cadence restarts; counts never run away', async () => {
    const { s, note } = await withNote();
    const T = T0 + MINUTE;
    const dto = s.reminders.create(utc(note.id, T, { followup: { intervalMinutes: 15, maxFollowups: 2 } }));
    const occ = dto.current!.occurrenceId;
    await s.start();
    await s.advance(MINUTE);
    expect(s.occurrence(occ)).toMatchObject({ followups_sent: 0, next_alert_at_utc: T + 15 * MINUTE });
    // Down from T+1 min to T+2 h.
    s.scheduler().stop();
    s.clock.set(T + 2 * HOUR);
    await s.restart();
    const restartAt = T + 2 * HOUR;
    expect(s.deliveries().map((d) => [d.kind, d.reason])).toEqual([
      ['initial', 'timer'],
      ['followup', 'startup'],
    ]);
    expect(s.occurrence(occ)).toMatchObject({ followups_sent: 1, next_alert_at_utc: restartAt + 15 * MINUTE });
    await s.advance(15 * MINUTE);
    expect(s.occurrence(occ)).toMatchObject({ followups_sent: 2, next_alert_at_utc: null });
    const ticks = s.scheduler().ticks();
    await s.advance(5 * MINUTE);
    expect(s.scheduler().ticks()).toBeGreaterThanOrEqual(ticks + 5);
    expect(s.deliveries()).toHaveLength(3);
  });

  it('an uncertain claim at startup adds no follow-up count', async () => {
    const { s, note } = await withNote();
    const dto = s.reminders.create(utc(note.id, T0 + MINUTE, { followup: { intervalMinutes: 15, maxFollowups: 2 } }));
    s.adapter.mode = 'hang';
    await s.start();
    await s.advance(MINUTE);
    s.adapter.mode = 'ok';
    await s.restart();
    expect(s.occurrence(dto.current!.occurrenceId)).toMatchObject({ followups_sent: 0, alert_sequence: 1 });
  });
});
