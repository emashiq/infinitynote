import { describe, expect, it } from 'vitest';
import { T0, at, reminderInput, setupReminders } from './reminder-helpers';

/**
 * Fixtures of plan section 12.1 (INF-REM-05) at T0 = 2026-10-08T07:00Z (13:00 Asia/Dhaka): A overdue, B today 21:00
 * Dhaka, C snoozed until 08:00Z, D tomorrow 09:00 Dhaka, E completed at 06:30Z, F missed yesterday, G on a trashed note,
 * H deleted, I cancelled.
 */
async function fixtures() {
  const s = await setupReminders({ now: at('2026-10-08T06:00:00Z') });
  const note = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Views').note;
  const make = (title: string, date: string, time: string) => s.reminders.create(reminderInput(note.id, { title, date, time, allowPast: true }));
  const sql = (q: string, ...args: unknown[]) => s.t.db.prepare(q).run(...args);

  const E = make('E', '2026-10-08', '20:00');
  s.clock.set(at('2026-10-08T06:30:00Z'));
  s.reminders.complete(E.current!.occurrenceId);
  s.clock.set(T0);
  make('A', '2026-10-08', '12:00');
  make('B', '2026-10-08', '21:00');
  const C = make('C', '2026-10-08', '12:30');
  s.reminders.snooze(C.current!.occurrenceId, 60);
  make('D', '2026-10-09', '09:00');
  // Series generation marks old occurrences missed and edits cancel alerted ones (reminders.test); set directly here.
  const F = make('F', '2026-10-07', '18:00');
  sql("UPDATE occurrences SET state = 'missed', next_alert_at_utc = NULL WHERE reminder_id = ?", F.id);
  const I = make('I', '2026-10-08', '18:00');
  sql("UPDATE occurrences SET state = 'cancelled', next_alert_at_utc = NULL WHERE reminder_id = ?", I.id);
  const H = make('H', '2026-10-08', '12:30');
  s.reminders.delete(H.id);
  const trashed = s.hierarchy.createNote({ projectId: null, folderId: null }, false, 'Trashed').note;
  s.reminders.create(reminderInput(trashed.id, { title: 'G', date: '2026-10-08', time: '12:30', allowPast: true }));
  s.trash.trashNote(trashed.id);
  return { s, note };
}

const titles = (items: Array<{ title: string }>) => items.map((i) => i.title);

describe('reminder views (INF-REM-05)', () => {
  it('Today, Upcoming, Overdue and Completed in the display zone, without trashed, deleted or cancelled', async () => {
    const { s } = await fixtures();
    const view = (v: 'today' | 'upcoming' | 'overdue' | 'completed') => s.reminders.listView(v, { kind: 'all' });
    expect(titles(view('overdue').items)).toEqual(['A']);
    expect(titles(view('today').items)).toEqual(['C', 'B']);
    expect(titles(view('upcoming').items)).toEqual(['D']);
    expect(titles(view('completed').items)).toEqual(['E', 'F']);
    expect(view('today')).toMatchObject({ view: 'today', asOf: T0, displayZone: 'Asia/Dhaka', counts: { today: 2, upcoming: 1, overdue: 1 } });
    const [c, b] = view('today').items;
    expect(c).toMatchObject({ state: 'snoozed', snoozedUntilUtc: at('2026-10-08T08:00:00Z'), effectiveAtUtc: at('2026-10-08T08:00:00Z'), overdue: false });
    expect(b).toMatchObject({ dueAtUtc: at('2026-10-08T15:00:00Z'), localDateTime: '2026-10-08T21:00', noteTitle: 'Views', notePath: ['Common'] });
    expect(view('overdue').items[0]).toMatchObject({ overdue: true, alertsSent: 0, lastOutcome: null, repeat: null });
    expect(view('completed').items[0]).toMatchObject({ state: 'completed', completedAt: at('2026-10-08T06:30:00Z') });
  });

  it('the display zone sets the day boundary: in New York tomorrow 09:00 Dhaka is still today', async () => {
    const { s } = await fixtures();
    s.zones.set('America/New_York');
    const today = s.reminders.listView('today', { kind: 'all' });
    expect(today.displayZone).toBe('America/New_York');
    expect(titles(today.items)).toEqual(['C', 'B', 'D']);
    expect(today.counts).toEqual({ today: 3, upcoming: 0, overdue: 1 });
  });

  it('scope: Common excludes a project note; a project scope shows only it', async () => {
    const { s } = await fixtures();
    const project = s.hierarchy.createProject('Work').project;
    const work = s.hierarchy.createNote({ projectId: project.id, folderId: null }, false, 'Work note').note;
    s.reminders.create(reminderInput(work.id, { title: 'P', date: '2026-10-08', time: '20:00' }));
    expect(titles(s.reminders.listView('today', { kind: 'common' }).items)).toEqual(['C', 'B']);
    expect(titles(s.reminders.listView('today', { kind: 'all' }).items)).toEqual(['C', 'P', 'B']);
    const scoped = s.reminders.listView('today', { kind: 'project', projectId: project.id });
    expect(titles(scoped.items)).toEqual(['P']);
    expect(scoped.items[0]!.notePath).toEqual(['Work']);
    expect(scoped.counts).toEqual({ today: 1, upcoming: 0, overdue: 0 });
  });

  it('summary: the first 5 overdue and due-today reminders with totals (INF-HOME-04)', async () => {
    const { s, note } = await fixtures();
    for (let i = 0; i < 6; i += 1) s.reminders.create(reminderInput(note.id, { title: `Late ${i}`, date: '2026-10-08', time: `0${i}:00`, allowPast: true }));
    const summary = s.reminders.summary({ kind: 'all' });
    expect(summary.overdue).toHaveLength(5);
    expect(summary.overdueTotal).toBe(7);
    expect(titles(summary.overdue)).toEqual(['Late 0', 'Late 1', 'Late 2', 'Late 3', 'Late 4']);
    expect(titles(summary.today)).toEqual(['C', 'B']);
    expect(summary).toMatchObject({ todayTotal: 2, asOf: T0, displayZone: 'Asia/Dhaka' });
  });
});
