import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ReminderCreateFromSuggestionRequest, ReminderUpdateFromSourceRequest, SuggestionDismissRequest } from '../../src/shared/contracts/suggestions';
import { reopen } from './helpers';
import { thrown } from './hierarchy-helpers';
import { at, doc, para, setupReminders, setupScheduler, T0 } from './reminder-helpers';

/** Plan section 12.3: the INF-SUG-04 to INF-SUG-09 cases against the real services and a temporary database. */

const P = randomUUID();
const P2 = randomUUID();
const SENTENCE = 'Have to submit this by tomorrow end of the day';
const BANK = 'Call the bank tomorrow';
const DHAKA = 'Asia/Dhaka';

type CreateInput = Parameters<typeof ReminderCreateFromSuggestionRequest.parse>[0];

/** The C2 phrase in block P, read at T0 in Dhaka (INF-SUG-05). */
function source(over: Record<string, unknown> = {}) {
  return { blockId: P, text: 'tomorrow end of the day', spanStart: 23, spanEnd: 46, spanOrdinal: 0, referenceInstantUtc: T0, referenceZone: DHAKA, origin: 'suggestion', ...over };
}

/** A create request as the router passes it to main: parsed by the strict schema, defaults applied. */
function create(noteId: string, over: Record<string, unknown> = {}) {
  return ReminderCreateFromSuggestionRequest.parse({
    noteId,
    title: 'Have to submit this',
    zoneId: DHAKA,
    date: '2026-10-09',
    time: '17:00',
    recurrence: null,
    followup: null,
    source: source(),
    ...over,
  } as CreateInput);
}

/** "tomorrow" in "Call the bank tomorrow" (block P), confirmed at the date-only default. */
const bankSource = (over: Record<string, unknown> = {}) => source({ text: 'tomorrow', spanStart: 14, spanEnd: 22, ...over });
const bankCreate = (noteId: string, over: Record<string, unknown> = {}) => create(noteId, { title: 'Call the bank', time: '09:00', source: bankSource(), ...over });

async function richNote(text = SENTENCE) {
  const s = await setupReminders();
  const n = s.editable('Report');
  n.save(doc(para(P, text), para(P2, 'Second paragraph')));
  return { s, n, noteId: n.note.id };
}

const sourceRows = (s: Awaited<ReturnType<typeof setupReminders>>) => s.rows<Record<string, unknown>>('SELECT * FROM reminder_sources ORDER BY created_at, reminder_id');
const tableCounts = (s: Awaited<ReturnType<typeof setupReminders>>) => [s.count('reminders'), s.count('occurrences'), sourceRows(s).length];

describe('source stored (INF-SUG-05)', () => {
  it('stores the reminder, its occurrence and every source column; the DTO carries the source', async () => {
    const { s, noteId } = await richNote();
    const res = s.reminders.createFromSource(create(noteId));
    expect(res.existing).toBe(false);
    const row = s.row<Record<string, unknown>>('SELECT * FROM reminders WHERE id = ?', res.reminder.id)!;
    expect(row).toMatchObject({ note_id: noteId, block_id: P, anchor_state: 'ok', title: 'Have to submit this', zone_id: DHAKA, start_local_date: '2026-10-09', local_time: '17:00' });
    expect(s.occurrences(res.reminder.id).map((o) => o.due_at_utc)).toEqual([at('2026-10-09T11:00:00Z')]);
    expect(sourceRows(s)).toEqual([
      {
        reminder_id: res.reminder.id,
        note_id: noteId,
        block_id: P,
        source_text: 'tomorrow end of the day',
        span_start: 23,
        span_end: 46,
        span_ordinal: 0,
        reference_instant_utc: T0,
        reference_zone: DHAKA,
        parser_version: 1,
        origin: 'suggestion',
        source_state: 'ok',
        created_at: T0,
        updated_at: T0,
      },
    ]);
    const expected = { blockId: P, text: 'tomorrow end of the day', spanOrdinal: 0, origin: 'suggestion', state: 'ok', referenceInstantUtc: T0, referenceZone: DHAKA };
    expect(res.reminder.source).toEqual(expected);
    expect(s.reminders.listForNote(noteId).reminders[0]!.source).toEqual(expected);
    expect(s.reminderEvents).toContainEqual({ reason: 'created', noteIds: [noteId] });
    expect(s.logger.lines).toContain(`INFO suggestions: reminder ${res.reminder.id} from source origin=suggestion state=ok existing=false`);
    expect(s.logger.lines.some((l) => l.includes('tomorrow end of the day'))).toBe(false);
  });

  it('no request can carry an instant, and main stores the date it is sent without reading the phrase', async () => {
    const { s, noteId } = await richNote();
    const base = { noteId, title: 'T', zoneId: DHAKA, date: '2026-10-09', time: '17:00', recurrence: null, followup: null, source: source() };
    expect(ReminderCreateFromSuggestionRequest.safeParse(base).success).toBe(true);
    for (const extra of [{ dueAtUtc: 1 }, { instantUtc: 1 }, { blockId: P }]) expect(ReminderCreateFromSuggestionRequest.safeParse({ ...base, ...extra }).success, JSON.stringify(extra)).toBe(false);
    expect(ReminderCreateFromSuggestionRequest.safeParse({ ...base, source: { ...source(), instantUtc: 1 } }).success).toBe(false);
    const res = s.reminders.createFromSource(create(noteId, { date: '2026-12-01', time: '08:15' }));
    expect(res.reminder).toMatchObject({ date: '2026-12-01', time: '08:15' });
    expect(s.occurrences(res.reminder.id).map((o) => o.due_at_utc)).toEqual([at('2026-12-01T02:15:00Z')]);
  });
});

describe('cancel creates nothing (INF-SUG-04)', () => {
  it('reading and dismissing never create reminders; every refused create leaves reminders, occurrences and sources unchanged', async () => {
    const { s, noteId } = await richNote();
    const plain = s.editable('Plain', 'plain');
    plain.save('Pay rent tomorrow');
    expect(s.suggestions.listDismissed(noteId)).toMatchObject({ asOf: T0, systemZone: DHAKA, defaultZone: DHAKA, dismissals: [] });
    s.suggestions.dismiss({ noteId, blockId: P, text: 'tomorrow end of the day', spanOrdinal: 0, referenceDate: '2026-10-08' });
    expect(tableCounts(s)).toEqual([0, 0, 0]);

    const refused: Array<[string, () => unknown, string, unknown]> = [
      ['past without allowPast', () => s.reminders.createFromSource(create(noteId, { date: '2026-10-01' })), 'VALIDATION_FAILED', { past: true }],
      ['unknown zone', () => s.reminders.createFromSource(create(noteId, { zoneId: 'Mars/Base' })), 'VALIDATION_FAILED', undefined],
      ['an abbreviation as the zone', () => s.reminders.createFromSource(create(noteId, { zoneId: 'EST' })), 'VALIDATION_FAILED', undefined],
      ['other text at the span', () => s.reminders.createFromSource(create(noteId, { source: source({ text: 'tomorrow end of the dax' }) })), 'VALIDATION_FAILED', { sourceMismatch: true }],
      ['another ordinal', () => s.reminders.createFromSource(create(noteId, { source: source({ spanOrdinal: 1 }) })), 'VALIDATION_FAILED', { sourceMismatch: true }],
      ['a block that is not stored', () => s.reminders.createFromSource(create(noteId, { source: source({ blockId: randomUUID() }) })), 'VALIDATION_FAILED', { blockMissing: true }],
      ['a span in a plain note', () => s.reminders.createFromSource(create(plain.note.id, { source: source({ text: 'tomorrow', spanStart: 9, spanEnd: 17 }) })), 'VALIDATION_FAILED', { sourceFormat: true }],
      ['no block in a rich note', () => s.reminders.createFromSource(create(noteId, { source: source({ blockId: null, spanStart: null, spanEnd: null }) })), 'VALIDATION_FAILED', { sourceFormat: true }],
      ['a reference over 400 days old', () => s.reminders.createFromSource(create(noteId, { source: source({ referenceInstantUtc: T0 - 401 * 86_400_000 }) })), 'VALIDATION_FAILED', undefined],
      ['a reference in the future', () => s.reminders.createFromSource(create(noteId, { source: source({ referenceInstantUtc: T0 + 10 * 60_000 }) })), 'VALIDATION_FAILED', undefined],
    ];
    for (const [name, call, code, details] of refused) {
      const error = thrown(call);
      expect({ name, code: error.code }).toEqual({ name, code });
      if (details) expect(error.details, name).toMatchObject(details);
      expect(tableCounts(s), name).toEqual([0, 0, 0]);
    }
    expect(thrown(() => s.reminders.createFromSource(create(noteId, { source: source({ referenceInstantUtc: T0 - 401 * 86_400_000 }) }))).message).toBe('The phrase was read too long ago. Read it again.');
    expect(thrown(() => s.reminders.createFromSource(create(noteId, { source: source({ text: 'tomorrow end of the dax' }) }))).message).toBe('The note text changed. Try again.');
    expect(ReminderCreateFromSuggestionRequest.safeParse({ ...create(noteId), dueAtUtc: T0 }).success).toBe(false);
    expect(tableCounts(s)).toEqual([0, 0, 0]);
  });
});

describe('dedupe after restart (INF-SUG-06)', () => {
  it('dismissals: one row per phrase, case and spacing ignored, ordinal and reference date counted; the same after a restart', async () => {
    const { s, noteId } = await richNote();
    const dismiss = (over: Record<string, unknown> = {}) =>
      s.suggestions.dismiss(SuggestionDismissRequest.parse({ noteId, blockId: P, text: 'tomorrow end of the day', spanOrdinal: 0, referenceDate: '2026-10-08', ...over })).dismissal;
    const first = dismiss();
    expect(first).toEqual({ blockId: P, text: 'tomorrow end of the day', spanOrdinal: 0, referenceDate: '2026-10-08', createdAt: T0 });
    s.clock.advance(1000);
    expect(dismiss()).toEqual(first);
    expect(dismiss({ text: '  Tomorrow   END of the day ' })).toEqual(first);
    const keys = s.rows<{ dedupe_key: string }>('SELECT dedupe_key FROM suggestion_dismissals');
    expect(keys).toHaveLength(1);
    expect(keys[0]!.dedupe_key).toMatch(/^[0-9a-f]{64}$/);
    dismiss({ spanOrdinal: 1 });
    dismiss({ referenceDate: '2026-10-09' });
    expect(s.count('reminders')).toBe(0);
    const listed = s.suggestions.listDismissed(noteId).dismissals;
    expect(listed).toHaveLength(3);
    expect(s.logger.lines).toContain(`INFO suggestions: dismissed note=${noteId}`);

    const after = await setupReminders({ testDb: await reopen(s.t) });
    expect(after.suggestions.listDismissed(noteId).dismissals).toEqual(listed);
    after.suggestions.dismiss({ noteId, blockId: P, text: 'TOMORROW end of the day', spanOrdinal: 0, referenceDate: '2026-10-08' });
    expect(after.rows('SELECT * FROM suggestion_dismissals')).toHaveLength(3);
  });

  it('dismissals follow the note format: rich needs a block, plain none; an absent note is NOT_FOUND, a trashed one still lists', async () => {
    const { s, noteId } = await richNote();
    const plain = s.editable('Plain', 'plain');
    expect(thrown(() => s.suggestions.dismiss({ noteId, blockId: null, text: 'x', spanOrdinal: 0, referenceDate: '2026-10-08' })).details).toEqual({ sourceFormat: true });
    expect(thrown(() => s.suggestions.dismiss({ noteId: plain.note.id, blockId: P, text: 'x', spanOrdinal: 0, referenceDate: '2026-10-08' })).details).toEqual({ sourceFormat: true });
    s.suggestions.dismiss({ noteId: plain.note.id, blockId: null, text: 'Friday', spanOrdinal: 0, referenceDate: '2026-10-08' });
    expect(thrown(() => s.suggestions.listDismissed(randomUUID())).code).toBe('NOT_FOUND');
    s.trash.trashNote(plain.note.id);
    expect(s.suggestions.listDismissed(plain.note.id).dismissals).toHaveLength(1);
    expect(thrown(() => s.suggestions.dismiss({ noteId: plain.note.id, blockId: null, text: 'x', spanOrdinal: 0, referenceDate: '2026-10-08' })).code).toBe('NOT_FOUND');
    expect(SuggestionDismissRequest.safeParse({ noteId, blockId: P, text: '   ', spanOrdinal: 0, referenceDate: '2026-10-08' }).success).toBe(false);
  });

  it('confirming the same phrase twice, also after a restart, gives the existing reminder; delete or keep allow a new one', async () => {
    const { s, noteId } = await richNote();
    const first = s.reminders.createFromSource(create(noteId));
    s.reminderEvents.length = 0;
    const again = s.reminders.createFromSource(create(noteId, { title: 'Other title', time: '18:00' }));
    expect(again).toMatchObject({ existing: true, reminder: { id: first.reminder.id, title: 'Have to submit this' } });
    expect(s.reminderEvents).toEqual([]);
    expect(s.count('reminders')).toBe(1);

    const restarted = await setupReminders({ testDb: await reopen(s.t) });
    expect(restarted.reminders.createFromSource(create(noteId)).existing).toBe(true);
    expect(restarted.count('reminders')).toBe(1);

    restarted.reminders.delete(first.reminder.id);
    const second = restarted.reminders.createFromSource(create(noteId));
    expect(second.existing).toBe(false);
    expect(second.reminder.id).not.toBe(first.reminder.id);

    restarted.reminders.updateFromSource(ReminderUpdateFromSourceRequest.parse({ action: 'keep', reminderId: second.reminder.id }));
    const third = restarted.reminders.createFromSource(create(noteId));
    expect(third.existing).toBe(false);
    expect(restarted.rows<{ id: string }>('SELECT id FROM reminders WHERE deleted_at IS NULL')).toHaveLength(2);
  });

  it('startup prune removes reference dates more than 2 days before today (UTC); a note keeps its newest 500', async () => {
    const { s, noteId } = await richNote();
    for (const date of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) {
      s.suggestions.dismiss({ noteId, blockId: P, text: 'tomorrow', spanOrdinal: 0, referenceDate: date });
    }
    expect(s.suggestions.pruneDismissals()).toBe(1);
    expect(s.rows<{ reference_date: string }>('SELECT reference_date FROM suggestion_dismissals ORDER BY reference_date').map((r) => r.reference_date)).toEqual([
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
    ]);
    expect(s.logger.lines).toContain('INFO suggestions: pruned 1 dismissals');

    for (let i = 0; i < 502; i += 1) {
      s.clock.advance(1000);
      s.suggestions.dismiss({ noteId, blockId: P2, text: 'Friday', spanOrdinal: i, referenceDate: '2026-10-08' });
    }
    const kept = s.rows<{ span_ordinal: number; block_id: string }>('SELECT span_ordinal, block_id FROM suggestion_dismissals WHERE note_id = ?', noteId);
    expect(kept).toHaveLength(500);
    expect(kept.some((r) => r.block_id === P)).toBe(false);
    expect(Math.min(...kept.map((r) => r.span_ordinal))).toBe(2);
    expect(s.suggestions.listDismissed(noteId).dismissals[0]).toMatchObject({ spanOrdinal: 501 });
  });
});

describe('next-day restart same instant (INF-SUG-07)', () => {
  it('a confirmed "tomorrow" keeps its date and instant after a restart on the next day; saving the same text changes nothing', async () => {
    const { s, n, noteId } = await richNote(BANK);
    const created = s.reminders.createFromSource(bankCreate(noteId)).reminder;
    expect(s.occurrences(created.id).map((o) => o.due_at_utc)).toEqual([at('2026-10-09T03:00:00Z')]);
    void n;

    const day2 = await setupScheduler({ testDb: await reopen(s.t), now: at('2026-10-09T05:00:00Z') });
    const [reminder] = day2.reminders.listForNote(noteId).reminders;
    expect(reminder).toMatchObject({ id: created.id, date: '2026-10-09', time: '09:00', revision: 1 });
    expect(reminder!.current).toMatchObject({ dueAtUtc: at('2026-10-09T03:00:00Z'), overdue: true });
    expect(reminder!.source).toEqual({ blockId: P, text: 'tomorrow', spanOrdinal: 0, origin: 'suggestion', state: 'ok', referenceInstantUtc: T0, referenceZone: DHAKA });

    const before = { reminder: day2.row('SELECT * FROM reminders WHERE id = ?', created.id), occurrences: day2.rows('SELECT * FROM occurrences ORDER BY id') };
    day2.edit({ id: noteId }).save(doc(para(P, BANK), para(P2, 'Second paragraph, edited on day two')));
    expect(day2.row<{ source_state: string }>('SELECT source_state FROM reminder_sources')!.source_state).toBe('ok');
    expect({ reminder: day2.row('SELECT * FROM reminders WHERE id = ?', created.id), occurrences: day2.rows('SELECT * FROM occurrences ORDER BY id') }).toEqual(before);

    await day2.start();
    await day2.advance(10 * 60_000);
    expect(day2.deliveries().map((d) => d.kind)).toEqual(['initial']);
    expect(day2.count('reminders')).toBe(1);
  });
});

describe('source changed state (INF-SUG-08)', () => {
  it('editing the phrase marks the source changed without moving the reminder; apply re-reads it, keep detaches it', async () => {
    const { s, n, noteId } = await richNote(BANK);
    const created = s.reminders.createFromSource(bankCreate(noteId)).reminder;
    const snapshot = () => ({ reminder: s.row('SELECT * FROM reminders WHERE id = ?', created.id), occurrences: s.rows('SELECT * FROM occurrences ORDER BY id') });
    const before = snapshot();
    s.reminderEvents.length = 0;
    n.save(doc(para(P, 'Call the bank next Friday'), para(P2, 'Second paragraph')));
    expect(s.row<{ source_state: string }>('SELECT source_state FROM reminder_sources')!.source_state).toBe('changed');
    expect(snapshot()).toEqual(before);
    expect(s.reminderEvents).toEqual([{ reason: 'anchor', noteIds: [noteId] }]);
    expect(s.logger.lines).toContain(`INFO suggestions: source ${created.id} ok->changed`);
    expect(s.reminders.listForNote(noteId).reminders[0]!.source?.state).toBe('changed');

    const apply = (over: Record<string, unknown> = {}) =>
      ReminderUpdateFromSourceRequest.parse({
        action: 'apply',
        reminderId: created.id,
        expectedRevision: 1,
        title: 'Call the bank',
        zoneId: DHAKA,
        date: '2026-10-16',
        time: '09:00',
        recurrence: null,
        followup: null,
        source: bankSource({ text: 'next Friday', spanStart: 14, spanEnd: 25 }),
        ...over,
      });
    const stale = thrown(() => s.reminders.updateFromSource(apply({ expectedRevision: 7 })));
    expect(stale).toMatchObject({ code: 'CONFLICT', details: { currentRevision: 1 } });
    expect(snapshot()).toEqual(before);
    expect(s.row<{ source_text: string; source_state: string }>('SELECT source_text, source_state FROM reminder_sources')).toEqual({ source_text: 'tomorrow', source_state: 'changed' });

    const updated = s.reminders.updateFromSource(apply());
    expect(updated).toMatchObject({ date: '2026-10-16', time: '09:00', revision: 2, source: { text: 'next Friday', state: 'ok' } });
    expect(s.occurrences(created.id).map((o) => o.due_at_utc)).toEqual([at('2026-10-16T03:00:00Z')]);

    n.save(doc(para(P, 'Call the bank someday'), para(P2, 'Second paragraph')));
    expect(s.reminders.updateFromSource(ReminderUpdateFromSourceRequest.parse({ action: 'keep', reminderId: created.id }))).toMatchObject({ revision: 2, source: { state: 'detached' } });
    n.save(doc(para(P, 'Call the bank next Friday'), para(P2, 'Second paragraph')));
    expect(s.row<{ source_state: string }>('SELECT source_state FROM reminder_sources')!.source_state).toBe('detached');
    expect(s.occurrences(created.id).map((o) => o.due_at_utc)).toEqual([at('2026-10-16T03:00:00Z')]);
  });

  it('a series with an overdue occurrence follows the pending policy; keep needs a source; a Phase 05 re-anchor detaches', async () => {
    const { s, n, noteId } = await richNote(BANK);
    const series = s.reminders.createFromSource(bankCreate(noteId, { recurrence: { freq: 'daily' } })).reminder;
    s.clock.set(at('2026-10-09T05:00:00Z'));
    s.reminders.ensureSeries(s.clock.now());
    const overdue = s.occurrences(series.id).find((o) => o.due_at_utc === at('2026-10-09T03:00:00Z'))!;
    n.save(doc(para(P, 'Call the bank next Friday'), para(P2, 'Second paragraph')));
    s.reminders.updateFromSource(
      ReminderUpdateFromSourceRequest.parse({
        action: 'apply',
        reminderId: series.id,
        expectedRevision: 1,
        pendingPolicy: 'complete',
        title: 'Call the bank',
        zoneId: DHAKA,
        date: '2026-10-16',
        time: '09:00',
        recurrence: { freq: 'daily' },
        followup: null,
        source: bankSource({ text: 'next Friday', spanStart: 14, spanEnd: 25, referenceInstantUtc: s.clock.now() }),
      }),
    );
    expect(s.occurrences(series.id).find((o) => o.id === overdue.id)!.state).toBe('completed');

    const manual = s.reminders.create({ noteId, blockId: null, title: 'By hand', zoneId: DHAKA, date: '2026-10-20', time: '09:00', recurrence: null, foldPreference: 'earlier', followup: null, allowPast: false });
    expect(thrown(() => s.reminders.updateFromSource({ action: 'keep', reminderId: manual.id }))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'This reminder was not created from note text.' });

    const latest = s.reminders.listForNote(noteId).reminders.find((r) => r.id === series.id)!;
    const moved = s.reminders.update({ ...latest, reminderId: latest.id, expectedRevision: latest.revision, blockId: P2, pendingPolicy: 'keep', allowPast: false });
    expect(moved.source?.state).toBe('detached');
  });
});

describe('block deleted (INF-SUG-09)', () => {
  it('a removed source block marks anchor and source missing; the reminder stays and alerts; restoring the block brings both back', async () => {
    const s = await setupScheduler();
    const n = s.editable('Report');
    n.save(doc(para(P, BANK), para(P2, 'Second paragraph')));
    const created = s.reminders.createFromSource(bankCreate(n.note.id)).reminder;
    const states = () => s.row<{ anchor_state: string; source_state: string }>('SELECT r.anchor_state, s.source_state FROM reminders r JOIN reminder_sources s ON s.reminder_id = r.id')!;

    n.save(doc(para(P2, 'Second paragraph')));
    expect(states()).toEqual({ anchor_state: 'block_missing', source_state: 'missing' });
    const [listed] = s.reminders.listForNote(n.note.id).reminders;
    expect(listed).toMatchObject({ id: created.id, blockId: P, anchorState: 'block_missing', source: { state: 'missing' } });
    expect(s.reminders.occurrenceSource(listed!.current!.occurrenceId)).toEqual({ noteId: n.note.id, blockId: null });
    await s.start();
    await s.advance(at('2026-10-09T03:00:00Z') - T0);
    expect(s.deliveries()).toHaveLength(1);

    n.save(doc(para(P, BANK), para(P2, 'Second paragraph')));
    expect(states()).toEqual({ anchor_state: 'ok', source_state: 'ok' });
    n.convert('plain');
    expect(states()).toEqual({ anchor_state: 'block_missing', source_state: 'missing' });
  });

  it('undo of a delete re-reads the source state from the stored content', async () => {
    const { s, n, noteId } = await richNote(BANK);
    const created = s.reminders.createFromSource(bankCreate(noteId)).reminder;
    s.reminders.delete(created.id);
    n.save(doc(para(P, 'Call the bank someday'), para(P2, 'Second paragraph')));
    expect(s.row<{ source_state: string }>('SELECT source_state FROM reminder_sources')!.source_state).toBe('ok');
    expect(s.reminders.undoDelete(created.id).source?.state).toBe('changed');
  });
});

describe('plain-text notes (D-092)', () => {
  it('sources are note-level with the ordinal over the whole text; the state follows the text and survives conversion to rich text', async () => {
    const s = await setupReminders();
    const n = s.editable('Plain', 'plain');
    n.save('Pay rent tomorrow\nand tomorrow again');
    const plainSource = (over: Record<string, unknown>) => source({ blockId: null, spanStart: null, spanEnd: null, text: 'tomorrow', ...over });
    expect(thrown(() => s.reminders.createFromSource(create(n.note.id, { source: plainSource({ spanOrdinal: 2 }) }))).details).toEqual({ sourceMismatch: true });
    const created = s.reminders.createFromSource(create(n.note.id, { time: '09:00', source: plainSource({ spanOrdinal: 1 }) })).reminder;
    expect(created).toMatchObject({ blockId: null, source: { blockId: null, spanOrdinal: 1, state: 'ok' } });
    expect(s.row('SELECT block_id, span_start, span_end, span_ordinal FROM reminder_sources')).toEqual({ block_id: null, span_start: null, span_end: null, span_ordinal: 1 });

    n.save('Pay rent soon');
    expect(s.row<{ source_state: string }>('SELECT source_state FROM reminder_sources')!.source_state).toBe('changed');
    n.save('Pay rent TOMORROW');
    expect(s.row<{ source_state: string }>('SELECT source_state FROM reminder_sources')!.source_state).toBe('ok');
    n.convert('rich');
    expect(s.row<{ source_state: string }>('SELECT source_state FROM reminder_sources')!.source_state).toBe('ok');
    expect(s.occurrences(created.id).map((o) => o.due_at_utc)).toEqual([at('2026-10-09T03:00:00Z')]);
  });
});
