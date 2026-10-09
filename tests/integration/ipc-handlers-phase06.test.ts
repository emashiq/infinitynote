import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AppHandlerDeps } from '../../src/main/ipc/handlers/app-handlers';
import { catalogueRouter } from './ipc-helpers';
import { T0, doc, para, reminderInput, setupReminders } from './reminder-helpers';

const MAIN = 1;
const STICKY = 3;
const WIDGET = 4;
const P = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const FORBIDDEN = { ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } };

const app: AppHandlerDeps = {
  getInfo: () => {
    throw new Error('not used');
  },
  getCapabilities: () => {
    throw new Error('not used');
  },
  shell: { openPath: async () => '', openExternal: async () => {} },
  dataDir: '/data',
  quit: () => {},
  flushed: () => false,
};

const source = (over: Record<string, unknown> = {}) => ({
  blockId: P,
  text: 'tomorrow',
  spanStart: 14,
  spanEnd: 22,
  spanOrdinal: 0,
  referenceInstantUtc: T0,
  referenceZone: 'Asia/Dhaka',
  origin: 'suggestion',
  ...over,
});
const createRequest = (noteId: string, over: Record<string, unknown> = {}) => ({
  noteId,
  title: 'Call the bank',
  zoneId: 'Asia/Dhaka',
  date: '2026-10-09',
  time: '09:00',
  recurrence: null,
  followup: null,
  source: source(),
  ...over,
});
const dismissRequest = (noteId: string, blockId: string | null = P) => ({ noteId, blockId, text: 'tomorrow', spanOrdinal: 0, referenceDate: '2026-10-08' });

/** The catalogue over the real services; window 3 is the sticky window of `own`, window 4 the widget. */
async function setup() {
  const s = await setupReminders();
  const own = s.editable('Own');
  own.save(doc(para(P, 'Call the bank tomorrow')));
  const other = s.editable('Other');
  other.save(doc(para(P, 'Call the bank tomorrow')));
  const r = catalogueRouter(s.services, app, { stickyNoteId: own.note.id });
  return { s, own: own.note, other: other.note, call: r.call };
}

describe('Phase 06 suggestion channels (D-089)', () => {
  it('main: confirm, update from source, keep, dismiss and list through the catalogue with response validation', async () => {
    const t = await setup();
    const created = await t.call('reminder:createFromSuggestion', createRequest(t.own.id), MAIN);
    expect(created).toMatchObject({ ok: true, data: { existing: false, reminder: { blockId: P, date: '2026-10-09', time: '09:00', source: { text: 'tomorrow', state: 'ok' } } } });
    expect((await t.call('reminder:createFromSuggestion', createRequest(t.own.id), MAIN)).data).toMatchObject({ existing: true, reminder: { id: created.data.reminder.id } });
    const id = created.data.reminder.id as string;

    const apply = { action: 'apply', reminderId: id, expectedRevision: 1, title: 'Call the bank', zoneId: 'Asia/Dhaka', date: '2026-10-10', time: '09:00', recurrence: null, followup: null, source: source() };
    expect((await t.call('reminder:updateFromSource', apply, MAIN)).data).toMatchObject({ date: '2026-10-10', revision: 2, source: { state: 'ok' } });
    expect((await t.call('reminder:updateFromSource', apply, MAIN)).error).toEqual({ code: 'CONFLICT', message: 'This reminder changed elsewhere. Reopen it to edit.', details: { currentRevision: 2 } });
    expect((await t.call('reminder:updateFromSource', { action: 'keep', reminderId: id }, MAIN)).data).toMatchObject({ revision: 2, source: { state: 'detached' } });

    expect((await t.call('suggestion:dismiss', dismissRequest(t.own.id), MAIN)).data).toEqual({
      dismissal: { blockId: P, text: 'tomorrow', spanOrdinal: 0, referenceDate: '2026-10-08', createdAt: T0 },
    });
    expect((await t.call('suggestion:listDismissed', { noteId: t.own.id }, MAIN)).data).toEqual({
      asOf: T0,
      systemZone: 'Asia/Dhaka',
      defaultZone: 'Asia/Dhaka',
      dismissals: [{ blockId: P, text: 'tomorrow', spanOrdinal: 0, referenceDate: '2026-10-08', createdAt: T0 }],
    });
  });

  it('errors use the envelope: phrase mismatch, missing block, past, format, unknown note, extra keys', async () => {
    const t = await setup();
    const err = async (payload: unknown) => (await t.call('reminder:createFromSuggestion', payload, MAIN)).error;
    expect(await err(createRequest(t.own.id, { source: source({ text: 'tomorrox' }) }))).toEqual({ code: 'VALIDATION_FAILED', message: 'The note text changed. Try again.', details: { sourceMismatch: true } });
    expect(await err(createRequest(t.own.id, { source: source({ blockId: randomUUID() }) }))).toMatchObject({ code: 'VALIDATION_FAILED', details: { blockMissing: true } });
    expect(await err(createRequest(t.own.id, { date: '2026-10-01' }))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'This time has already passed', details: { past: true } });
    expect(await err(createRequest(t.own.id, { source: source({ blockId: null, spanStart: null, spanEnd: null }) }))).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'This phrase does not belong to this note.',
      details: { sourceFormat: true },
    });
    expect((await err(createRequest(randomUUID())))?.code).toBe('NOT_FOUND');
    expect((await err({ ...createRequest(t.own.id), dueAtUtc: T0 }))?.code).toBe('VALIDATION_FAILED');
    expect((await t.call('suggestion:listDismissed', { noteId: randomUUID() }, MAIN)).error?.code).toBe('NOT_FOUND');
    expect(t.s.count('reminders')).toBe(0);
  });

  it('a sticky confirms, adds and dismisses only for its own note; updating from source stays in the main window', async () => {
    const t = await setup();
    expect((await t.call('zones:list', {}, STICKY)).ok).toBe(true);
    const mine = await t.call('reminder:createFromSuggestion', createRequest(t.own.id), STICKY);
    expect(mine).toMatchObject({ ok: true, data: { existing: false, reminder: { noteId: t.own.id } } });
    expect((await t.call('reminder:create', reminderInput(t.own.id, { title: 'By hand' }), STICKY)).ok).toBe(true);
    expect((await t.call('suggestion:dismiss', dismissRequest(t.own.id), STICKY)).ok).toBe(true);
    expect((await t.call('suggestion:listDismissed', { noteId: t.own.id }, STICKY)).data.dismissals).toHaveLength(1);

    expect(await t.call('reminder:createFromSuggestion', createRequest(t.other.id), STICKY)).toEqual(FORBIDDEN);
    expect(await t.call('reminder:create', reminderInput(t.other.id), STICKY)).toEqual(FORBIDDEN);
    expect(await t.call('suggestion:dismiss', dismissRequest(t.other.id), STICKY)).toEqual(FORBIDDEN);
    expect(await t.call('suggestion:listDismissed', { noteId: t.other.id }, STICKY)).toEqual(FORBIDDEN);
    expect(await t.call('reminder:updateFromSource', { action: 'keep', reminderId: mine.data.reminder.id }, STICKY)).toEqual(FORBIDDEN);
    expect(t.s.rows<{ note_id: string }>('SELECT note_id FROM reminders').map((r) => r.note_id)).toEqual([t.own.id, t.own.id]);
    expect(t.s.row<{ source_state: string }>('SELECT source_state FROM reminder_sources')!.source_state).toBe('ok');
    expect(t.s.rows('SELECT * FROM suggestion_dismissals WHERE note_id = ?', t.other.id)).toEqual([]);
  });

  it('the widget may call none of the four channels', async () => {
    const t = await setup();
    const created = (await t.call('reminder:createFromSuggestion', createRequest(t.own.id), MAIN)).data.reminder;
    const calls: Array<[string, unknown]> = [
      ['reminder:createFromSuggestion', createRequest(t.other.id)],
      ['reminder:updateFromSource', { action: 'keep', reminderId: created.id }],
      ['suggestion:dismiss', dismissRequest(t.own.id)],
      ['suggestion:listDismissed', { noteId: t.own.id }],
    ];
    for (const [channel, payload] of calls) expect(await t.call(channel, payload, WIDGET), channel).toEqual(FORBIDDEN);
    expect(t.s.count('reminders')).toBe(1);
    expect(t.s.row<{ source_state: string }>('SELECT source_state FROM reminder_sources')!.source_state).toBe('ok');
  });

  it('without storage every suggestion channel answers INTERNAL "Storage is unavailable"', async () => {
    const r = catalogueRouter(null, app);
    const noteId = randomUUID();
    for (const [channel, payload] of [
      ['reminder:createFromSuggestion', createRequest(noteId)],
      ['reminder:updateFromSource', { action: 'keep', reminderId: noteId }],
      ['suggestion:dismiss', dismissRequest(noteId)],
      ['suggestion:listDismissed', { noteId }],
    ] as const) {
      expect(await r.call(channel, payload), channel).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Storage is unavailable' } });
    }
  });
});
