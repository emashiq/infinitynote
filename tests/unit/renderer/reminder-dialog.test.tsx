// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReminderDtoType } from '../../../src/shared/contracts/reminders';
import { ReminderDialog } from '../../../src/renderer/reminders/ReminderDialog';
import { CHOOSE_ZONE, formProblem, initialForm, needsPendingChoice, PAST_TEXT, previewOf, shortcutDates, type ReminderForm } from '../../../src/renderer/reminders/reminder-form';
import { AppServicesContext } from '../../../src/renderer/state/use-store';
import { createFakeBridge } from './support/fake-bridge';
import { setupServices } from './support/services';

const NOTE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const followupDefault = { enabled: false, intervalMinutes: 15 as const, maxFollowups: 2 as const };
const base = (over: Partial<ReminderForm> = {}): ReminderForm => ({
  ...initialForm({ reminder: null, title: 'Pay rent', blockId: null, defaultZone: 'America/New_York', asOf: Date.parse('2026-01-01T00:00:00Z'), followupDefault }),
  ...over,
});

describe('reminder form (INF-REM-01, 03, 11, 13, 14)', () => {
  it('gap and fold notices; the later choice and its label', () => {
    const gap = previewOf(base({ date: '2026-03-08', time: '02:30' }), 'America/New_York')!;
    expect(gap.gap).toBe('02:30 does not exist on this date in New York; the reminder will use 03:00');
    expect(gap.primary).toBe('Sun 8 Mar 2026, 03:00 · America/New_York');
    const fold = previewOf(base({ date: '2026-11-01', time: '01:30' }), 'America/New_York')!;
    expect(fold.fold).toEqual({ notice: '01:30 happens twice on this date; using the earlier one', laterLabel: 'Use the later one (EST)' });
    expect(previewOf(base({ date: '2026-11-01', time: '01:30', foldPreference: 'later' }), 'America/New_York')!.fold!.notice).toBe('01:30 happens twice on this date; using the later one');
  });

  it('"Your time" only when the computer’s wall clock reads differently', () => {
    const ny = base({ date: '2026-10-09', time: '09:00' });
    expect(previewOf(ny, 'Asia/Dhaka')!.local).toBe('Your time: Fri 9 Oct 2026, 19:00 · Asia/Dhaka');
    expect(previewOf(ny, 'America/New_York')!.local).toBeNull();
  });

  it('Today and Tomorrow are dates in the selected zone', () => {
    const asOf = Date.parse('2026-10-08T03:30:00Z');
    expect(shortcutDates(asOf, 'America/New_York')).toEqual({ today: '2026-10-07', tomorrow: '2026-10-08' });
    expect(shortcutDates(asOf, 'Asia/Dhaka')).toEqual({ today: '2026-10-08', tomorrow: '2026-10-09' });
  });

  it('follow-ups start off by default; a zone is required when none is known', () => {
    expect(base().followupOn).toBe(false);
    expect(base({ zoneId: '' }).zoneId).toBe('');
    expect(formProblem(base({ zoneId: '' }))).toBe(CHOOSE_ZONE);
    expect(initialForm({ reminder: null, title: 'x', blockId: null, defaultZone: null, asOf: 0, followupDefault }).zoneId).toBe('');
    expect(formProblem(base({ repeat: 'weekly', weekdays: [] }))).toBe('Choose at least one day');
    expect(formProblem(base())).toBeNull();
  });

  it('the pending-policy choice appears only for schedule changes of a series with an overdue occurrence', () => {
    const series = {
      id: NOTE,
      noteId: NOTE,
      blockId: null,
      anchorState: 'ok',
      title: 'Stand-up',
      zoneId: 'Asia/Dhaka',
      date: '2026-10-08',
      time: '09:00',
      recurrence: { freq: 'daily' },
      foldPreference: 'earlier',
      followup: null,
      revision: 1,
      createdAt: 0,
      updatedAt: 0,
      resolution: { status: 'ok' },
      current: { overdue: true },
    } as unknown as ReminderDtoType;
    const form = initialForm({ reminder: series, title: '', blockId: null, defaultZone: null, asOf: 0, followupDefault });
    expect(needsPendingChoice(form, series)).toBe(false);
    expect(needsPendingChoice({ ...form, title: 'Renamed' }, series)).toBe(false);
    expect(needsPendingChoice({ ...form, time: '10:00' }, series)).toBe(true);
    expect(needsPendingChoice({ ...form, time: '10:00' }, { ...series, current: { overdue: false } } as unknown as ReminderDtoType)).toBe(false);
    expect(needsPendingChoice({ ...form, time: '10:00' }, null)).toBe(false);
  });
});

describe('ReminderDialog past flow', () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('a past time asks first; Add anyway sends allowPast', async () => {
    const fake = createFakeBridge();
    const { services } = await setupServices({ fake });
    fake.failNext('reminder:create', { code: 'VALIDATION_FAILED', message: 'This time has already passed', details: { past: true, dueAtUtc: 0 } });
    let closed = false;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const settle = async () => {
      for (let i = 0; i < 6; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
    };
    await act(async () =>
      root.render(
        <AppServicesContext.Provider value={services}>
          <ReminderDialog noteId={NOTE} reminder={null} blockId={null} title="Pay rent" persistBlocks={null} onClose={() => (closed = true)} />
        </AppServicesContext.Provider>,
      ),
    );
    await settle();
    expect(host.querySelector('h2')?.textContent).toBe('Add reminder');
    const save = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    await act(async () => save.click());
    await settle();
    expect(host.textContent).toContain(PAST_TEXT);
    expect(closed).toBe(false);
    const anyway = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add anyway')!;
    await act(async () => anyway.click());
    await settle();
    const creates = fake.callsTo('reminder:create').map((c) => (c.req as { allowPast: boolean; title: string; zoneId: string }));
    expect(creates.map((c) => c.allowPast)).toEqual([false, true]);
    expect(creates[1]).toMatchObject({ title: 'Pay rent', zoneId: 'Asia/Dhaka' });
    expect(closed).toBe(true);
    act(() => root.unmount());
  });
});
