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
    const order = fake.calls.map((c) => c.channel).filter((ch) => ch === 'collab:flush' || ch === 'app:flushed');
    expect(order).toEqual(['collab:flush', 'app:flushed']);
    expect(fake.callsTo('app:flushed')[0]!.req).toEqual({ flushId: '55555555-5555-4555-8555-000000000001', saved: true });

    const texts = () => services.notices.store.getState().notices.map((n) => n.text);
    typeInto(services.tabs.activeController()!, 'refused');
    fake.failNext('collab:flush', { code: 'LIMIT_EXCEEDED' });
    fake.emit('app:flush-request', { flushId: '55555555-5555-4555-8555-000000000002', reason: 'close' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('app:flushed')[1]!.req).toEqual({ flushId: '55555555-5555-4555-8555-000000000002', saved: false });
    expect(texts()).toContain('Could not save this note. The window stays open.');

    fake.failNext('collab:flush', { code: 'LIMIT_EXCEEDED' });
    fake.emit('app:flush-request', { flushId: '55555555-5555-4555-8555-000000000003', reason: 'quit' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('app:flushed')[2]!.req).toEqual({ flushId: '55555555-5555-4555-8555-000000000003', saved: false });
    expect(texts()).toContain('Could not save this note, so Infinity Notes did not quit. Quit again to quit without saving it.');

    // A save main refused but kept as a draft is safe: the window may close.
    typeInto(services.tabs.activeController()!, ' conflicting');
    fake.failNext('collab:flush', { code: 'CONFLICT', details: { currentRevision: 9, draftId: '55555555-5555-4555-8555-0000000000dd', reason: 'stale' } });
    fake.emit('app:flush-request', { flushId: '55555555-5555-4555-8555-000000000004', reason: 'close' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('app:flushed')[3]!.req).toEqual({ flushId: '55555555-5555-4555-8555-000000000004', saved: true });
  });

  it("another view's steps, main's save status and a reset reach the active note (D-103)", async () => {
    const { services, fake } = await setupServices();
    const a = await makeNote(fake, undefined, 'A');
    await services.tabs.openNote(a.id);
    await vi.advanceTimersByTimeAsync(0);
    const controller = services.tabs.activeController()!;
    const editor = typeInto(controller, 'mine');
    await vi.advanceTimersByTimeAsync(0);
    // Another view (a sticky) joins and types: its steps reach the tab through main.
    const other = await fake.bridge.collab.join({ noteId: a.id, viewId: OTHER_VIEW });
    if (!other.ok) throw new Error('join');
    const insert = { stepType: 'replace', from: 5, to: 5, slice: { content: [{ type: 'text', text: ' and theirs' }] } };
    const pushed = await fake.bridge.collab.push({ noteId: a.id, viewId: OTHER_VIEW, epoch: other.data.epoch, version: other.data.version, steps: [insert] });
    expect(pushed).toMatchObject({ ok: true, data: { status: 'accepted' } });
    expect(editor.text).toBe('mine and theirs');
    await vi.advanceTimersByTimeAsync(400);
    expect(controller.store.getState().save).toBe('saved');
    // A write outside the session: the tab joins again.
    const joins = fake.callsTo('collab:join').length;
    await fake.bridge.note.save({ noteId: a.id, viewId: OTHER_VIEW, baseRevision: controller.store.getState().revision, requestId: OTHER_VIEW, format: 'rich', content: { type: 'doc', content: [] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('collab:join')).toHaveLength(joins + 1);
    expect(controller.store.getState().contentKey).toBe(2);
    // Events for another note are not this controller's business.
    fake.emit('collab:reset', { noteId: '00000000-0000-4000-8000-0000000000ff', conflict: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.callsTo('collab:join')).toHaveLength(joins + 1);
  });

  it('attachment settings follow the public settings and their changes; the main window remembers an add choice', async () => {
    const { services, fake } = await setupServices();
    expect(services.editor.attachmentPrefs()).toEqual({ imageMaxMb: 20, documentMaxMb: 25, addFiles: 'ask' });
    await fake.bridge.settings.set({ key: 'attachments.imageMaxMb', value: 5 });
    expect(services.editor.attachmentPrefs()).toEqual({ imageMaxMb: 5, documentMaxMb: 25, addFiles: 'ask' });
    fake.emit('settings:changed', { key: 'attachments.documentMaxMb', value: 'nonsense', updatedAt: 1 });
    fake.emit('settings:changed', { key: 'attachments.documentMaxMb', value: 50, updatedAt: 1 });
    expect(services.editor.attachmentPrefs().documentMaxMb).toBe(25);
    fake.emit('settings:changed', { key: 'attachments.addFiles', value: 'link', updatedAt: 2 });
    expect(services.editor.attachmentPrefs().addFiles).toBe('link');
    services.editor.rememberAddFiles!('copy');
    expect(services.editor.attachmentPrefs().addFiles).toBe('copy');
    expect(fake.callsTo('settings:set').at(-1)?.req).toEqual({ key: 'attachments.addFiles', value: 'copy' });
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
    expect(services.tabs.activeController()!.store.getState()).toMatchObject({ format: 'plain', content: { type: 'doc', content: [{ type: 'paragraph' }] } });
  });

  it('the notes main queued during load open and join their session (D-071)', async () => {
    const { createFakeBridge } = await import('../support/fake-bridge');
    const fake = createFakeBridge();
    const a = await makeNote(fake, undefined, 'Docked');
    const { services } = await setupServices({ fake, initialOpens: [{ noteId: a.id, blockId: null }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${a.id}`);
    expect(services.tabs.activeController()!.store.getState().status).toBe('ready');
    expect(fake.callsTo('collab:join')).toHaveLength(1);
  });

  it('app:openNote opens or activates the tab', async () => {
    const { services, fake } = await setupServices();
    const a = await makeNote(fake, undefined, 'A');
    fake.emit('app:openNote', { noteId: a.id, blockId: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${a.id}`);
    await services.tabs.activate('home');
    fake.emit('app:openNote', { noteId: a.id, blockId: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(services.tabs.store.getState().session.activeTabId).toBe(`note:${a.id}`);
    expect(services.tabs.activeController()!.store.getState().status).toBe('ready');
  });

  it('dispose unsubscribes every event listener', async () => {
    const { services, fake } = await setupServices();
    expect(fake.subscriberCount()).toBeGreaterThan(0);
    await services.dispose();
    expect(fake.subscriberCount()).toBe(0);
  });
});
