// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OccurrenceItemType } from '../../../../src/shared/contracts/reminders';
import { makeNote, setupServices } from '../support/services';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number, over: Partial<OccurrenceItemType> = {}): OccurrenceItemType => ({
  occurrenceId: ID(n),
  reminderId: ID(100 + n),
  noteId: ID(200),
  blockId: null,
  anchorState: 'ok',
  noteTitle: 'Report',
  notePath: ['Common'],
  title: `R${n}`,
  zoneId: 'Asia/Dhaka',
  dueAtUtc: 1,
  localDateTime: '2026-10-09T17:00',
  state: 'pending',
  snoozedUntilUtc: null,
  effectiveAtUtc: 1,
  overdue: true,
  alertsSent: 1,
  followupsSent: 0,
  repeat: null,
  lastOutcome: 'failed',
  completedAt: null,
  ...over,
});

describe('RemindersStore (plan section 9.6)', () => {
  it('startup: overdue reminders raise the banner; reminder:changed re-reads the view and Home’s summary', async () => {
    const { createFakeBridge } = await import('../support/fake-bridge');
    const fake = createFakeBridge();
    fake.data.reminders.views.overdue = [item(1), item(2)];
    const { services } = await setupServices({ fake });
    expect(services.reminders.store.getState()).toMatchObject({ startupOverdue: 2, view: 'today' });
    expect(services.reminders.store.getState().summary?.overdueTotal).toBe(2);
    const reads = fake.callsTo('reminders:listView').length;
    fake.data.reminders.views.today = [item(3, { overdue: false })];
    fake.emit('reminder:changed', { reason: 'created', noteIds: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('reminders:listView').length).toBe(reads + 1);
    expect(services.reminders.store.getState().items.map((i) => i.title)).toEqual(['R3']);
    services.reminders.dismissStartup();
    expect(services.reminders.store.getState().startupOverdue).toBeNull();
  });

  it('alerts: up to 3 one by one; a 4th or a summary collapses them; Done removes its alert', async () => {
    const { services, fake } = await setupServices();
    fake.data.reminders.views.overdue = [item(1)];
    const alert = (n: number) => ({ batchId: ID(900 + n), outcome: 'failed' as const, presentation: 'single' as const, total: 1, items: [item(n)] });
    for (const n of [1, 2, 3]) fake.emit('reminder:alert', alert(n));
    expect(services.reminders.store.getState().alerts.map((a) => (a.kind === 'single' ? a.item.title : a.total))).toEqual(['R1', 'R2', 'R3']);
    // A follow-up alert of the same reminder replaces its entry.
    fake.emit('reminder:alert', alert(2));
    expect(services.reminders.store.getState().alerts).toHaveLength(3);
    await services.reminders.complete(item(1));
    expect(services.reminders.store.getState().alerts.map((a) => (a.kind === 'single' ? a.item.title : a.total))).toEqual(['R3', 'R2']);
    fake.emit('reminder:alert', alert(4));
    fake.emit('reminder:alert', alert(5));
    expect(services.reminders.store.getState().alerts).toEqual([{ id: expect.any(Number), kind: 'summary', total: 4 }]);
  });

  it('open reveals the block; delete offers Undo; app:openReminders opens the tab on the view; widget state follows main', async () => {
    const { services, fake } = await setupServices();
    const note = await makeNote(fake, undefined, 'Source');
    const block = ID(300);
    await services.reminders.open(item(1, { noteId: note.id, blockId: block }));
    await vi.advanceTimersByTimeAsync(0);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${note.id}`);
    expect(services.tabs.activeController()!.store.getState().reveal).toEqual({ blockId: block, nonce: 1 });

    const created = await fake.bridge.reminder.create({ noteId: note.id, blockId: null, title: 'Undo me', zoneId: 'Asia/Dhaka', date: '2026-10-09', time: '17:00', recurrence: null, followup: null });
    if (!created.ok) throw new Error('create');
    await services.reminders.delete(created.data.id);
    const notice = services.notices.store.getState().notices.at(-1)!;
    expect(notice).toMatchObject({ text: 'Reminder deleted', action: { label: 'Undo' } });
    notice.action!.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('reminder:undoDelete')).toHaveLength(1);

    fake.emit('app:openReminders', { view: 'overdue' });
    await vi.advanceTimersByTimeAsync(0);
    expect(services.tabs.store.getState().session.activeTabId).toBe('page:reminders');
    expect(services.reminders.store.getState().view).toBe('overdue');

    fake.emit('widget:state', { open: true, collapsed: false, alwaysOnTop: false });
    expect(services.reminders.store.getState().widget.open).toBe(true);
    await services.reminders.setWidgetOpen(false);
    expect(fake.callsTo('widget:hide')).toHaveLength(1);
    expect(services.reminders.store.getState().widget.open).toBe(false);
  });
});
