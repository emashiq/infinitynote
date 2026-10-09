import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStickyServices } from '../../../../src/renderer/stickies/sticky-services';
import type { CapabilitiesType } from '../../../../src/shared/contracts/app';
import type { StickyStateType } from '../../../../src/shared/contracts/stickies';
import { createFakeBridge, type FakeBridge } from '../support/fake-bridge';
import { typeInto } from '../support/editor-source';
import { makeNote, testUuid } from '../support/services';

const BATCH = '66666666-6666-4666-8666-666666666666';
const status = (s: 'supported' | 'unsupported') => ({ status: s, reason: 'test' });
const caps = (alwaysOnTop: 'supported' | 'unsupported'): CapabilitiesType => ({
  platform: 'win32',
  environment: 'windows',
  sessionType: 'windows',
  ozonePlatform: null,
  windowPositioning: status('supported'),
  alwaysOnTop: status(alwaysOnTop),
  tray: status('supported'),
  nativeNotifications: status('unsupported'),
  notificationActions: status('unsupported'),
  launchAtLogin: status('unsupported'),
  globalShortcut: status('unsupported'),
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup(opts: { activation?: number; pin?: 'supported' | 'unsupported'; role?: 'main' | 'other-note' } = {}) {
  const fake = createFakeBridge();
  const note = await makeNote(fake, undefined, 'Groceries', true);
  fake.data.setCapabilities(caps(opts.pin ?? 'supported'));
  // Main has this note's window open.
  fake.data.floating.set(note.id, { collapsed: false, alwaysOnTop: false, activation: opts.activation ?? 1 });
  const state: StickyStateType = fake.stickyState(note.id);
  if (opts.role === 'main') fake.data.setWindowState({ role: 'main', openNotes: [], openReminders: null, widget: { open: false, collapsed: false, alwaysOnTop: false } });
  else if (opts.role === 'other-note') fake.data.setWindowState({ role: 'sticky', sticky: { ...state, noteId: BATCH } });
  else fake.data.setWindowState({ role: 'sticky', sticky: state });
  const s = createStickyServices(fake.bridge, note.id, { themeEnv: null, lifecycle: null, randomUUID: testUuid });
  await s.ready;
  await vi.advanceTimersByTimeAsync(0);
  const emitState = (patch: Partial<StickyStateType>) => fake.emit('sticky:state', { ...s.sticky.getState().current!, ...patch });
  return { fake, note, s, state, emitState, noticeTexts: () => s.core.notices.store.getState().notices.map((n) => n.text) };
}

const stored = (fake: FakeBridge, id: string) => fake.data.notes.find((n) => n.id === id)!;

describe('sticky services (plan section 9.3)', () => {
  it('a floated window (activation > 0) joins its note\'s live sync and focuses its editor (D-103)', async () => {
    const { fake, s } = await setup({ activation: 1 });
    expect(s.phase.getState().phase).toBe('ready');
    expect(fake.callsTo('collab:join')).toHaveLength(1);
    expect(s.controller.store.getState().status).toBe('ready');
    expect(s.focusEditor.getState().request).toBe(1);
  });

  it('a restored window (activation 0) joins too and leaves the focus where it is', async () => {
    const { fake, s } = await setup({ activation: 0 });
    expect(fake.callsTo('collab:join')).toHaveLength(1);
    expect(s.controller.store.getState().status).toBe('ready');
    expect(s.focusEditor.getState().request).toBe(0);
  });

  it('a later activation focuses the editor; an unchanged one does not', async () => {
    const { s, emitState } = await setup({ activation: 0 });
    emitState({ activation: 0, color: 'blue' });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.focusEditor.getState().request).toBe(0);
    expect(s.sticky.getState().current?.color).toBe('blue');
    emitState({ activation: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.focusEditor.getState().request).toBe(1);
  });

  it('a window whose route the main process does not confirm is invalid and opens nothing', async () => {
    for (const role of ['main', 'other-note'] as const) {
      const { fake, s } = await setup({ role });
      expect(s.phase.getState().phase).toBe('invalid');
      expect(fake.callsTo('note:open')).toHaveLength(0);
    }
  });

  it('trash keeps pending edits as a draft and shows the notice; restore reopens the editor with a notice', async () => {
    const { fake, note, s, emitState, noticeTexts } = await setup();
    typeInto(s.controller, 'pending');
    Object.assign(stored(fake, note.id), { deletedAt: 5, batch: BATCH });
    emitState({ trashed: { batchId: BATCH } });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.controller.store.getState()).toMatchObject({ status: 'trashed', trashBatchId: BATCH });
    expect(fake.data.drafts.map((d) => d.reason)).toEqual(['conflict']);
    expect(noticeTexts()).toContain('Your unsaved edits to "Groceries" were kept as a recovered draft. Restore the note from Trash to see them.');

    await s.actions.restore();
    expect(fake.callsTo('sticky:restore').map((c) => c.req)).toEqual([{ noteId: note.id }]);
    expect(noticeTexts()).toContain('Restored to Common');
    emitState({ trashed: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.controller.store.getState()).toMatchObject({ status: 'ready', drafts: [expect.objectContaining({ reason: 'conflict' })] });
  });

  it('a flush request flushes the note and then acknowledges', async () => {
    const { fake, s } = await setup();
    typeInto(s.controller, 'closing');
    fake.emit('app:flush-request', { flushId: '55555555-5555-4555-8555-000000000001', reason: 'close' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.calls.map((c) => c.channel).filter((ch) => ch === 'collab:flush' || ch === 'app:flushed')).toEqual(['collab:flush', 'app:flushed']);
    expect(fake.callsTo('app:flushed')[0]!.req).toEqual({ flushId: '55555555-5555-4555-8555-000000000001', saved: true });
    typeInto(s.controller, ' failing');
    fake.failNext('collab:flush', { code: 'LIMIT_EXCEEDED' });
    fake.emit('app:flush-request', { flushId: '55555555-5555-4555-8555-000000000002', reason: 'quit' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('app:flushed')[1]!.req).toEqual({ flushId: '55555555-5555-4555-8555-000000000002', saved: false });
  });

  it('steps from the note\'s other views reach the sticky; a reset of another note is ignored', async () => {
    const { fake, note, s } = await setup();
    const editor = typeInto(s.controller, 'sticky');
    await vi.advanceTimersByTimeAsync(0);
    const tab = await fake.bridge.collab.join({ noteId: note.id, viewId: BATCH });
    if (!tab.ok) throw new Error('join');
    await fake.bridge.collab.push({ noteId: note.id, viewId: BATCH, epoch: tab.data.epoch, version: tab.data.version, steps: [{ stepType: 'replace', from: 7, to: 7, slice: { content: [{ type: 'text', text: ' and tab' }] } } as { stepType: string }] });
    expect(editor.text).toBe('sticky and tab');
    const joins = fake.callsTo('collab:join').length;
    fake.emit('collab:reset', { noteId: BATCH, conflict: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('collab:join')).toHaveLength(joins);
  });

  it('header actions: color, collapse, pin (not where unsupported), dock and remove flush first, trash', async () => {
    const { fake, note, s } = await setup();
    await s.actions.setColor('green');
    expect(s.sticky.getState().current?.color).toBe('green');
    await s.actions.toggleCollapsed();
    expect(s.sticky.getState().current?.collapsed).toBe(true);
    await s.actions.togglePinned();
    expect(fake.callsTo('sticky:setPinned').map((c) => c.req)).toEqual([{ noteId: note.id, pinned: true }]);
    typeInto(s.controller, 'docked');
    await s.actions.dock();
    const order = fake.calls.map((c) => c.channel).filter((ch) => ch === 'collab:flush' || ch === 'sticky:dock');
    expect(order).toEqual(['collab:flush', 'sticky:dock']);
    await s.actions.remove();
    expect(fake.callsTo('sticky:remove')).toHaveLength(1);
    expect(await s.actions.trash()).toEqual({ ok: true, data: undefined });
    expect(fake.callsTo('note:trash').map((c) => c.req)).toEqual([{ noteId: note.id }]);

    const unsupported = await setup({ pin: 'unsupported' });
    await unsupported.s.actions.togglePinned();
    expect(unsupported.fake.callsTo('sticky:setPinned')).toHaveLength(0);
  });

  it('hide, dock, remove and trash save first and stay put with a notice when the text is not saved (D-072)', async () => {
    const { fake, s, noticeTexts } = await setup();
    for (const action of ['hide', 'dock', 'remove', 'trash'] as const) {
      typeInto(s.controller, ` ${action}`);
      fake.failNext('collab:flush', { code: 'LIMIT_EXCEEDED', message: 'too big' });
      await s.actions[action]();
    }
    for (const channel of ['sticky:hide', 'sticky:dock', 'sticky:remove', 'note:trash']) expect(fake.callsTo(channel), channel).toEqual([]);
    expect(noticeTexts()).toContain('Could not save this note. The window stays open.');
    await s.actions.hide();
    expect(fake.callsTo('sticky:hide')).toHaveLength(1);
  });

  it('a failed action shows its message', async () => {
    const { fake, s, noticeTexts } = await setup();
    fake.failNext('sticky:setPinned', { code: 'UNSUPPORTED', message: 'Not supported by this desktop' });
    await s.actions.togglePinned();
    expect(noticeTexts()).toContain('Not supported by this desktop');
  });

  it('dispose unsubscribes everything and leaves the live-sync session (INF-STKY-11)', async () => {
    const { fake, s } = await setup();
    expect(fake.subscriberCount()).toBeGreaterThan(0);
    await s.dispose();
    expect(fake.subscriberCount()).toBe(0);
    expect(fake.callsTo('collab:leave')).toHaveLength(1);
  });
});
