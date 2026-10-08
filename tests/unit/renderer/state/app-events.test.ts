import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { typeInto } from '../support/editor-source';
import { makeNote, setupServices } from '../support/services';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const OTHER_VIEW = '33333333-3333-4333-8333-333333333333';

describe('app events reach the active note (plan section 10.3)', () => {
  it('app:flush-request flushes the active note, then answers whether the text is safe; a failure says why (D-072)', async () => {
    const { services, fake } = await setupServices();
    const a = await makeNote(fake, undefined, 'A');
    await services.tabs.openNote(a.id);
    await vi.advanceTimersByTimeAsync(0);
    typeInto(services.tabs.activeController()!, 'closing now');
    fake.emit('app:flush-request', { flushId: '55555555-5555-4555-8555-000000000001', reason: 'close' });
    await vi.advanceTimersByTimeAsync(0);
    const order = fake.calls.map((c) => c.channel).filter((ch) => ch === 'note:save' || ch === 'app:flushed');
    expect(order).toEqual(['note:save', 'app:flushed']);
    expect(fake.callsTo('app:flushed')[0]!.req).toEqual({ flushId: '55555555-5555-4555-8555-000000000001', saved: true });

    const texts = () => services.notices.store.getState().notices.map((n) => n.text);
    typeInto(services.tabs.activeController()!, 'refused');
    fake.failNext('note:save', { code: 'LIMIT_EXCEEDED' });
    fake.emit('app:flush-request', { flushId: '55555555-5555-4555-8555-000000000002', reason: 'close' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('app:flushed')[1]!.req).toEqual({ flushId: '55555555-5555-4555-8555-000000000002', saved: false });
    expect(texts()).toContain('Could not save this note. The window stays open.');

    fake.failNext('note:save', { code: 'LIMIT_EXCEEDED' });
    fake.emit('app:flush-request', { flushId: '55555555-5555-4555-8555-000000000003', reason: 'quit' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('app:flushed')[2]!.req).toEqual({ flushId: '55555555-5555-4555-8555-000000000003', saved: false });
    expect(texts()).toContain('Could not save this note, so Infinity Notes did not quit. Quit again to quit without saving it.');

    // A save main refused but kept as a draft is safe: the window may close.
    Object.assign(fake.data.notes.find((n) => n.id === a.id)!, { revision: 99 });
    typeInto(services.tabs.activeController()!, ' conflicting');
    fake.emit('app:flush-request', { flushId: '55555555-5555-4555-8555-000000000004', reason: 'close' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('app:flushed')[3]!.req).toEqual({ flushId: '55555555-5555-4555-8555-000000000004', saved: true });
  });

  it('note:revision from another view reloads the active note; note:lease updates it; release requests hand it over', async () => {
    const { services, fake } = await setupServices();
    const a = await makeNote(fake, undefined, 'A');
    await services.tabs.openNote(a.id);
    await vi.advanceTimersByTimeAsync(0);
    const controller = services.tabs.activeController()!;
    const opens = fake.callsTo('note:open').length;
    fake.emit('note:revision', { noteId: a.id, revision: 1, sourceViewId: OTHER_VIEW });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('note:open')).toHaveLength(opens + 1);

    fake.emit('note:lease', { noteId: a.id, holderViewId: OTHER_VIEW });
    expect(controller.store.getState().holderElsewhere).toBe(true);

    fake.emit('lease:release-request', { noteId: a.id });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('lease:release')).toHaveLength(1);
    expect(controller.store.getState()).toMatchObject({ status: 'readOnly', readOnlyReason: 'lease' });
    // A request for another note is not this controller's business.
    fake.emit('lease:release-request', { noteId: '00000000-0000-4000-8000-0000000000ff' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('lease:release')).toHaveLength(1);
  });

  it('attachment limits follow the public settings and their changes', async () => {
    const { services, fake } = await setupServices();
    expect(services.editor.limits()).toEqual({ imageMaxMb: 20, documentMaxMb: 50 });
    await fake.bridge.settings.set({ key: 'attachments.imageMaxMb', value: 5 });
    expect(services.editor.limits()).toEqual({ imageMaxMb: 5, documentMaxMb: 50 });
    fake.emit('settings:changed', { key: 'attachments.documentMaxMb', value: 'nonsense', updatedAt: 1 });
    expect(services.editor.limits().documentMaxMb).toBe(50);
  });

  it('Ctrl+F (note.find) asks the active note to open find; on Home it does nothing', async () => {
    const { services, fake } = await setupServices();
    await services.commands.run('note.find');
    expect(services.ui.store.getState().focusRequest).toBeNull();
    const a = await makeNote(fake, undefined, 'A');
    await services.tabs.openNote(a.id);
    await services.commands.run('note.find');
    expect(services.ui.store.getState().focusRequest).toEqual({ target: 'noteFind', noteId: a.id });
  });

  it('note.newPlain creates a plain-text note and opens it', async () => {
    const { services, fake } = await setupServices();
    await services.commands.run('note.newPlain');
    expect(fake.callsTo('note:create')[0]!.req).toMatchObject({ format: 'plain', sticky: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(services.tabs.activeController()!.store.getState()).toMatchObject({ format: 'plain', content: '' });
  });

  it('the note opens main queued during load open with edit control (D-071)', async () => {
    const { createFakeBridge } = await import('../support/fake-bridge');
    const fake = createFakeBridge();
    const a = await makeNote(fake, undefined, 'Docked');
    fake.data.heldElsewhere.add(a.id);
    const { services } = await setupServices({ fake, initialOpens: [{ noteId: a.id, takeEdit: true }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${a.id}`);
    expect(services.tabs.activeController()!.store.getState().status).toBe('ready');
    expect(fake.callsTo('lease:take')).toHaveLength(1);
  });

  it('app:openNote opens or activates the tab, taking edit control when asked', async () => {
    const { services, fake } = await setupServices();
    const a = await makeNote(fake, undefined, 'A');
    fake.emit('app:openNote', { noteId: a.id, takeEdit: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${a.id}`);
    expect(fake.callsTo('lease:take')).toHaveLength(0);
    await services.tabs.activate('home');
    fake.data.heldElsewhere.add(a.id);
    fake.emit('app:openNote', { noteId: a.id, takeEdit: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${a.id}`);
    expect(services.tabs.activeController()!.store.getState().status).toBe('ready');
    expect(fake.callsTo('lease:take')).toHaveLength(1);
  });

  it('dispose unsubscribes every event listener', async () => {
    const { services, fake } = await setupServices();
    expect(fake.subscriberCount()).toBeGreaterThan(0);
    await services.dispose();
    expect(fake.subscriberCount()).toBe(0);
  });
});
