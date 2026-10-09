import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { thrown } from './hierarchy-helpers';
import { HOUR, MINUTE, T0, at, doc, para, reminderInput, setupReminders, setupScheduler, settle, updateRequest } from './reminder-helpers';

const B = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const C = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

describe('reminders: create (INF-REM-01)', () => {
  it('a reminder on a saved paragraph: zone, due instant, anchor and one pending occurrence; the note is untouched', async () => {
    const s = await setupReminders();
    const n = s.editable('Report');
    n.save(doc(para(B, 'Submit the report')));
    const before = s.row<{ revision: number; updated_at: number }>('SELECT revision, updated_at FROM notes WHERE id = ?', n.note.id)!;
    s.clock.advance(MINUTE);
    const dto = s.reminders.create(reminderInput(n.note.id, { blockId: B }));
    expect(dto).toMatchObject({ zoneId: 'Asia/Dhaka', blockId: B, anchorState: 'ok', resolution: { status: 'ok' }, revision: 1 });
    expect(dto.current).toMatchObject({ dueAtUtc: at('2026-10-09T11:00:00Z'), state: 'pending', overdue: false, title: 'Submit report', noteTitle: 'Report' });
    expect([s.count('reminders'), s.count('occurrences')]).toEqual([1, 1]);
    expect(s.occurrences(dto.id)).toEqual([
      expect.objectContaining({ due_at_utc: at('2026-10-09T11:00:00Z'), next_alert_at_utc: at('2026-10-09T11:00:00Z'), original_local_date_time: '2026-10-09T17:00', state: 'pending' }),
    ]);
    expect(s.row('SELECT revision, updated_at FROM notes WHERE id = ?', n.note.id)).toEqual(before);
    expect(s.reminderEvents).toEqual([{ reason: 'created', noteIds: [n.note.id] }]);
    expect(s.reminderWrites.count).toBe(1);
  });

  it('refusals store nothing: unknown zones, missing or trashed notes, unsaved blocks, plain-text blocks', async () => {
    const s = await setupReminders();
    const n = s.editable('Report');
    n.save(doc(para(B, 'Saved')));
    const plain = s.editable('Plain', 'plain');
    plain.save('plain text');
    const trashed = s.editable('Trashed');
    const batch = s.trash.trashNote(trashed.note.id).trashBatchId;
    for (const zoneId of ['Mars/Base', 'CST']) {
      expect(thrown(() => s.reminders.create(reminderInput(n.note.id, { zoneId })))).toEqual({ code: 'VALIDATION_FAILED', message: 'Choose a time zone from the list', details: undefined });
    }
    expect(thrown(() => s.reminders.create(reminderInput(trashed.note.id)))).toEqual({
      code: 'NOT_FOUND',
      message: 'This note no longer exists',
      details: { trashed: true, trashBatchId: batch },
    });
    expect(thrown(() => s.reminders.create(reminderInput(randomUUID())))).toMatchObject({ code: 'NOT_FOUND', message: 'This note no longer exists' });
    expect(thrown(() => s.reminders.create(reminderInput(n.note.id, { blockId: C })))).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'This part of the note is not saved yet',
      details: { blockMissing: true },
    });
    expect(thrown(() => s.reminders.create(reminderInput(plain.note.id, { blockId: B })))).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Plain-text notes can only have note-level reminders',
    });
    expect([s.count('reminders'), s.count('occurrences')]).toEqual([0, 0]);
    expect(s.reminderEvents).toEqual([]);
  });

  it('a past time needs allowPast and is then overdue without a notification', async () => {
    const s = await setupReminders();
    const n = s.editable('Late');
    const past = thrown(() => s.reminders.create(reminderInput(n.note.id, { date: '2026-10-08', time: '12:00' })));
    expect(past).toEqual({ code: 'VALIDATION_FAILED', message: 'This time has already passed', details: { past: true, dueAtUtc: at('2026-10-08T06:00:00Z') } });
    expect(s.count('reminders')).toBe(0);
    const dto = s.reminders.create(reminderInput(n.note.id, { date: '2026-10-08', time: '12:00', allowPast: true }));
    expect(s.occurrences(dto.id)).toEqual([expect.objectContaining({ state: 'pending', next_alert_at_utc: null })]);
    expect(s.reminders.listView('overdue', { kind: 'all' }).items.map((i) => i.reminderId)).toEqual([dto.id]);
  });

  it('at most 200 reminders per note; a sticky note accepts reminders', async () => {
    const s = await setupReminders();
    const n = s.editable('Many');
    for (let i = 0; i < 200; i += 1) s.reminders.create(reminderInput(n.note.id, { title: `R${i}` }));
    expect(thrown(() => s.reminders.create(reminderInput(n.note.id)))).toMatchObject({ code: 'LIMIT_EXCEEDED', message: 'A note can have at most 200 reminders.' });
    expect(s.count('reminders')).toBe(200);
    // A deleted reminder frees its place.
    const first = s.reminders.listForNote(n.note.id).reminders[0]!;
    s.reminders.delete(first.id);
    expect(() => s.reminders.create(reminderInput(n.note.id))).not.toThrow();
    const sticky = s.hierarchy.createNote({ projectId: null, folderId: null }, true, 'Sticky').note;
    expect(s.reminders.create(reminderInput(sticky.id)).noteId).toBe(sticky.id);
  });

  it('a recurring series starts at its first future instant; past dates of the series are skipped', async () => {
    const s = await setupReminders();
    const n = s.editable('Daily');
    // Daily 09:00 Dhaka from 2026-10-01: at T0 (13:00 Dhaka) the first occurrence is tomorrow 09:00 = 03:00Z.
    const dto = s.reminders.create(reminderInput(n.note.id, { date: '2026-10-01', time: '09:00', recurrence: { freq: 'daily' } }));
    expect(s.occurrences(dto.id).map((o) => o.due_at_utc)).toEqual([at('2026-10-09T03:00:00Z')]);
    expect(dto.recurrence).toEqual({ freq: 'daily' });
  });
});

describe('reminders: edit series pending policy (INF-REM-13)', () => {
  async function overdueSeries() {
    // Daily 09:00 Dhaka; at 2026-10-08T04:00Z today's occurrence (03:00Z) is open and overdue.
    const s = await setupReminders({ now: at('2026-10-08T02:00:00Z') });
    const n = s.editable('Series');
    const dto = s.reminders.create(reminderInput(n.note.id, { date: '2026-10-08', time: '09:00', recurrence: { freq: 'daily' } }));
    s.clock.set(at('2026-10-08T04:00:00Z'));
    s.reminders.ensureSeries(s.clock.now());
    const rows = s.occurrences(dto.id);
    expect(rows.map((o) => [o.due_at_utc, o.state])).toEqual([
      [at('2026-10-08T03:00:00Z'), 'pending'],
      [at('2026-10-09T03:00:00Z'), 'pending'],
    ]);
    return { s, dto, overdue: rows[0]!, future: rows[1]! };
  }
  const edit = (dto: { id: string; revision: number }, over: Parameters<typeof updateRequest>[2]) =>
    updateRequest(dto.id, dto.revision, { date: '2026-10-08', time: '09:00', recurrence: { freq: 'daily' }, ...over });

  it('keep: the overdue occurrence is unchanged, the not-yet-due one is deleted and the new schedule starts', async () => {
    const { s, dto, overdue, future } = await overdueSeries();
    const updated = s.reminders.update(edit(dto, { time: '10:00' }));
    const rows = s.occurrences(dto.id);
    expect(rows.find((o) => o.id === overdue.id)).toEqual(overdue);
    expect(rows.some((o) => o.id === future.id)).toBe(false);
    expect(rows.map((o) => [o.due_at_utc, o.state])).toEqual([
      [at('2026-10-08T03:00:00Z'), 'pending'],
      [at('2026-10-09T04:00:00Z'), 'pending'],
    ]);
    expect(updated.revision).toBe(2);
    expect(updated.time).toBe('10:00');
  });

  it('complete: the overdue occurrence is completed', async () => {
    const { s, dto, overdue } = await overdueSeries();
    s.reminders.update(edit(dto, { time: '10:00', pendingPolicy: 'complete' }));
    expect(s.occurrences(dto.id).find((o) => o.id === overdue.id)).toMatchObject({ state: 'completed', completed_at: at('2026-10-08T04:00:00Z') });
  });

  it('a title-only edit keeps occurrence ids; a stale revision is a conflict', async () => {
    const { s, dto } = await overdueSeries();
    const ids = s.occurrences(dto.id).map((o) => o.id);
    s.reminders.update(edit(dto, { title: 'Stand-up' }));
    expect(s.occurrences(dto.id).map((o) => o.id)).toEqual(ids);
    expect(thrown(() => s.reminders.update(edit(dto, { title: 'Again' })))).toEqual({
      code: 'CONFLICT',
      message: 'This reminder changed elsewhere. Reopen it to edit.',
      details: { currentRevision: 2 },
    });
  });

  it('a one-time reminder that already alerted is cancelled (deliveries kept); one that never alerted is replaced', async () => {
    const s = await setupReminders();
    const n = s.editable('Once');
    const alerted = s.reminders.create(reminderInput(n.note.id, { date: '2026-10-08', time: '14:00' }));
    const quiet = s.reminders.create(reminderInput(n.note.id, { date: '2026-10-08', time: '14:00', title: 'Quiet' }));
    s.clock.set(at('2026-10-08T08:30:00Z'));
    const alertedOcc = s.occurrences(alerted.id)[0]!;
    s.t.db
      .prepare<[string, string]>(
        "INSERT INTO alert_deliveries(id, occurrence_id, alert_sequence, kind, presentation, batch_id, reason, claimed_at, outcome) VALUES (?, ?, 0, 'initial', 'single', 'b', 'timer', 1, 'dispatched')",
      )
      .run(randomUUID(), alertedOcc.id);
    const tomorrow = (dto: typeof alerted) => updateRequest(dto.id, 1, { title: dto.title, date: '2026-10-09', time: '14:00' });
    s.reminders.update(tomorrow(alerted));
    s.reminders.update(tomorrow(quiet));
    expect(s.occurrences(alerted.id).map((o) => [o.id === alertedOcc.id, o.state, o.next_alert_at_utc])).toEqual([
      [true, 'cancelled', null],
      [false, 'pending', at('2026-10-09T08:00:00Z')],
    ]);
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM alert_deliveries WHERE occurrence_id = ?', alertedOcc.id)!.n).toBe(1);
    expect(s.occurrences(quiet.id).map((o) => [o.state, o.due_at_utc])).toEqual([['pending', at('2026-10-09T08:00:00Z')]]);
    // Done or Snooze on the replaced occurrence explains what happened.
    expect(thrown(() => s.reminders.complete(alertedOcc.id))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'This reminder was replaced by an edit' });
    expect(thrown(() => s.reminders.snooze(alertedOcc.id, 10))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'This reminder was replaced by an edit' });
  });

  it('occurrences deleted by a schedule edit never had deliveries', async () => {
    const { s, dto, future } = await overdueSeries();
    expect(s.row<{ n: number }>('SELECT count(*) AS n FROM alert_deliveries WHERE occurrence_id = ?', future.id)!.n).toBe(0);
    s.reminders.update(edit(dto, { time: '11:00' }));
    expect(s.row('SELECT id FROM occurrences WHERE id = ?', future.id)).toBeUndefined();
  });
});

describe('reminders: block missing (INF-REM-17, D-080)', () => {
  it('a save without the block marks it missing, a version restore brings it back, a plain conversion removes it', async () => {
    const s = await setupReminders();
    const n = s.editable('Anchored');
    n.save(doc(para(B, 'Pay rent'), para(C, 'Other')));
    const dto = s.reminders.create(reminderInput(n.note.id, { blockId: B }));
    s.reminderEvents.length = 0;
    const state = () => s.row<{ anchor_state: string }>('SELECT anchor_state FROM reminders WHERE id = ?', dto.id)!.anchor_state;

    s.clock.advance(11 * MINUTE);
    n.save(doc(para(C, 'Other')));
    expect(state()).toBe('block_missing');
    expect(s.reminderEvents).toEqual([{ reason: 'anchor', noteIds: [n.note.id] }]);
    // The reminder stays on its note and stays due.
    expect(s.reminders.listForNote(n.note.id).reminders[0]).toMatchObject({ anchorState: 'block_missing', current: { state: 'pending' } });
    // A further save that changes nothing about the anchor emits nothing more.
    n.save(doc(para(C, 'Other edited')));
    expect(s.reminderEvents).toHaveLength(1);

    const versions = s.versions.list(n.note.id).versions;
    const withB = versions.find((v) => v.preview.includes('Pay rent'))!;
    n.restore(withB.id);
    expect(state()).toBe('ok');
    n.convert('plain');
    expect(state()).toBe('block_missing');
    expect(s.reminderEvents.map((e) => e.reason)).toEqual(['anchor', 'anchor', 'anchor']);
    // Keep note-level: an edit with no block clears the anchor.
    const current = s.reminders.listForNote(n.note.id).reminders[0]!;
    s.reminders.update(updateRequest(dto.id, current.revision));
    expect(s.row('SELECT block_id, anchor_state FROM reminders WHERE id = ?', dto.id)).toEqual({ block_id: null, anchor_state: 'ok' });
  });
});

describe('reminders: delete with undo (INF-REM-18)', () => {
  it('delete hides the reminder everywhere; undo within 10 s brings it back, after that it is refused', async () => {
    const s = await setupReminders();
    const n = s.editable('Undo');
    const a = s.reminders.create(reminderInput(n.note.id, { date: '2026-10-08', time: '15:00' }));
    s.clock.advance(1);
    const b = s.reminders.create(reminderInput(n.note.id, { date: '2026-10-08', time: '16:00', title: 'Second' }));
    expect(s.reminders.delete(a.id)).toEqual({ reminderId: a.id, undoUntil: T0 + 1 + 10_000 });
    expect(s.row<{ deleted_at: number }>('SELECT deleted_at FROM reminders WHERE id = ?', a.id)!.deleted_at).toBe(T0 + 1);
    expect(s.reminders.listForNote(n.note.id).reminders.map((r) => r.id)).toEqual([b.id]);
    expect(s.reminders.listView('today', { kind: 'all' }).items.map((i) => i.reminderId)).toEqual([b.id]);
    s.clock.advance(9_000);
    expect(s.reminders.undoDelete(a.id).id).toBe(a.id);
    expect(s.reminders.listForNote(n.note.id).reminders.map((r) => r.id)).toEqual([a.id, b.id]);
    s.reminders.delete(b.id);
    s.clock.advance(11_000);
    expect(thrown(() => s.reminders.undoDelete(b.id))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'Undo is no longer available' });
    expect(thrown(() => s.reminders.delete(b.id))).toMatchObject({ code: 'NOT_FOUND', message: 'This reminder no longer exists' });
    expect(s.reminderEvents.map((e) => e.reason)).toEqual(['created', 'created', 'deleted', 'restored', 'deleted']);
  });
});

describe('reminders: done and snooze rules (INF-REM-09, INF-REM-10)', () => {
  it('Done is idempotent; Snooze needs a due open occurrence', async () => {
    const s = await setupReminders();
    const n = s.editable('Rules');
    const dto = s.reminders.create(reminderInput(n.note.id, { date: '2026-10-08', time: '14:00' }));
    const occ = dto.current!.occurrenceId;
    expect(thrown(() => s.reminders.snooze(occ, 10))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'This reminder is not due yet' });
    s.clock.advance(2 * HOUR);
    const snoozed = s.reminders.snooze(occ, 10);
    expect(snoozed).toMatchObject({ state: 'snoozed', snoozedUntilUtc: T0 + 2 * HOUR + 10 * MINUTE, effectiveAtUtc: T0 + 2 * HOUR + 10 * MINUTE });
    expect(s.occurrences(dto.id)[0]!.next_alert_at_utc).toBe(T0 + 2 * HOUR + 10 * MINUTE);
    const done = s.reminders.complete(occ);
    expect(done).toMatchObject({ state: 'completed', completedAt: T0 + 2 * HOUR, snoozedUntilUtc: null });
    expect(s.reminders.complete(occ)).toEqual(done);
    expect(thrown(() => s.reminders.snooze(occ, 10))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'This reminder can no longer be snoozed' });
  });

  it('a missed occurrence cannot be snoozed; completing a series occurrence keeps one future occurrence', async () => {
    const s = await setupReminders({ now: at('2026-10-08T02:00:00Z') });
    const n = s.editable('Series');
    const dto = s.reminders.create(reminderInput(n.note.id, { date: '2026-10-08', time: '09:00', recurrence: { freq: 'daily' } }));
    s.clock.set(at('2026-10-10T04:00:00Z'));
    s.reminders.ensureSeries(s.clock.now());
    const rows = s.occurrences(dto.id);
    expect(rows.map((o) => [new Date(o.due_at_utc).toISOString(), o.state])).toEqual([
      ['2026-10-08T03:00:00.000Z', 'missed'],
      ['2026-10-10T03:00:00.000Z', 'pending'],
      ['2026-10-11T03:00:00.000Z', 'pending'],
    ]);
    expect(thrown(() => s.reminders.snooze(rows[0]!.id, 5))).toMatchObject({ message: 'This reminder can no longer be snoozed' });
    // Done ahead of time completes only that occurrence; the series gets its next one.
    s.reminders.complete(rows[2]!.id);
    expect(s.occurrences(dto.id).map((o) => [new Date(o.due_at_utc).toISOString(), o.state])).toEqual([
      ['2026-10-08T03:00:00.000Z', 'missed'],
      ['2026-10-10T03:00:00.000Z', 'pending'],
      ['2026-10-11T03:00:00.000Z', 'completed'],
      ['2026-10-12T03:00:00.000Z', 'pending'],
    ]);
    // Completing the overdue one leaves the future occurrence alone.
    s.reminders.complete(rows[1]!.id);
    expect(s.occurrences(dto.id).filter((o) => o.state === 'pending').map((o) => o.due_at_utc)).toEqual([at('2026-10-12T03:00:00Z')]);
    expect(s.occurrences(dto.id)).toHaveLength(4);
  });
});

describe('reminders: trash (INF-REM-17)', () => {
  it('a trashed note hides its reminders from every view; restore shows them again', async () => {
    const s = await setupReminders();
    const n = s.editable('Trash me');
    const dto = s.reminders.create(reminderInput(n.note.id, { date: '2026-10-08', time: '15:00' }));
    const all = () => (['today', 'upcoming', 'overdue', 'completed'] as const).flatMap((v) => s.reminders.listView(v, { kind: 'all' }).items);
    expect(all()).toHaveLength(1);
    const { trashBatchId } = s.trash.trashNote(n.note.id);
    expect(all()).toEqual([]);
    expect(s.reminders.summary({ kind: 'all' })).toMatchObject({ overdueTotal: 0, todayTotal: 0 });
    s.trash.restore(trashBatchId);
    expect(all().map((i) => i.reminderId)).toEqual([dto.id]);
  });
});

describe('reminders: zones (INF-REM-02, INF-REM-15)', () => {
  it('the zone list includes the computer zone; the default follows the setting, else the computer', async () => {
    const s = await setupReminders({ zone: 'America/New_York' });
    expect(s.reminders.zones()).toMatchObject({ systemZone: 'America/New_York', defaultZone: 'America/New_York', asOf: T0 });
    expect(s.reminders.zones().zones).toContain('UTC');
    s.settings.set('reminders.defaultZone', 'Asia/Dhaka');
    expect(s.reminders.zones().defaultZone).toBe('Asia/Dhaka');
    s.zones.set(null);
    s.settings.set('reminders.defaultZone', null);
    expect(s.reminders.zones()).toMatchObject({ systemZone: null, defaultZone: null });
  });

  it('an unknown computer zone counts days in UTC and says so through a null display zone', async () => {
    const s = await setupReminders({ zone: null, now: at('2026-10-08T22:00:00Z') });
    const n = s.editable('UTC days');
    // 23:30Z is still 8 October in UTC (today); in Dhaka it would already be tomorrow.
    s.reminders.create(reminderInput(n.note.id, { zoneId: 'Asia/Dhaka', date: '2026-10-09', time: '05:30' }));
    const today = s.reminders.listView('today', { kind: 'all' });
    expect(today.displayZone).toBeNull();
    expect(today.items).toHaveLength(1);
  });
});

describe('reminders with the scheduler (INF-REM-17, INF-REM-18)', () => {
  it('trash suspend: nothing alerts while trashed; restore sends one batch, singles up to 3 and a summary above', async () => {
    for (const n of [2, 5]) {
      const s = await setupScheduler();
      const note = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Suspended').note;
      for (let i = 0; i < n; i += 1) s.reminders.create(reminderInput(note.id, { title: `R${i}`, date: '2026-10-08', time: '17:00' }));
      await s.start();
      await s.advance(3 * HOUR);
      const { trashBatchId } = s.trash.trashNote(note.id);
      await s.advance(2 * HOUR);
      expect(s.adapter.shown()).toEqual([]);
      expect(s.reminders.listView('overdue', { kind: 'all' }).items).toEqual([]);
      s.trash.restore(trashBatchId);
      const ticks = s.scheduler().ticks();
      s.scheduler().wake('restore');
      await settle();
      expect(s.scheduler().ticks()).toBe(ticks + 1);
      const deliveries = s.deliveries();
      expect(deliveries).toHaveLength(n);
      expect(new Set(deliveries.map((d) => d.reason))).toEqual(new Set(['restore']));
      expect(new Set(deliveries.map((d) => d.batch_id)).size).toBe(1);
      if (n === 2) expect(s.adapter.shown().map((x) => x.title).sort()).toEqual(['R0', 'R1']);
      else expect(s.adapter.shown().map((x) => x.body)).toEqual(['5 reminders are overdue']);
      expect(new Set(deliveries.map((d) => d.presentation))).toEqual(new Set([n === 2 ? 'single' : 'summary']));
      await s.advance(5 * MINUTE);
      expect(s.deliveries()).toHaveLength(n);
    }
  });

  it('a reminder whose block was deleted still alerts on its note', async () => {
    const s = await setupScheduler();
    const n = s.editable('Anchored');
    n.save(doc(para(B, 'Pay rent'), para(C, 'Other')));
    s.reminders.create(reminderInput(n.note.id, { blockId: B, zoneId: 'UTC', date: '2026-10-08', time: '07:05' }));
    n.save(doc(para(C, 'Other')));
    await s.start();
    await s.advance(5 * MINUTE);
    expect(s.adapter.shown().map((x) => x.title)).toEqual(['Submit report']);
    s.adapter.click(1);
    expect(s.opened).toEqual([{ noteId: n.note.id, blockId: null }]);
  });

  it('a deleted reminder does not alert; undone within 10 s it alerts once', async () => {
    const s = await setupScheduler();
    const note = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Undo').note;
    const dto = s.reminders.create(reminderInput(note.id, { zoneId: 'UTC', date: '2026-10-08', time: '07:01' }));
    await s.start();
    await s.advance(55_000);
    s.reminders.delete(dto.id);
    await s.advance(6_000);
    expect(s.adapter.shown()).toEqual([]);
    await s.advance(3_000);
    s.reminders.undoDelete(dto.id);
    await settle();
    expect(s.adapter.shown()).toHaveLength(1);
    await s.advance(2 * MINUTE);
    expect(s.adapter.shown()).toHaveLength(1);
  });
});
