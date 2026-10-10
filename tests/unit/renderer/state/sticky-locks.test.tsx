// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActivityReporter } from '../../../../src/renderer/stickies/activity-reporter';
import { createStickyServices } from '../../../../src/renderer/stickies/sticky-services';
import { STICKY_LOCK_TEXT, StickyLockPanel } from '../../../../src/renderer/stickies/StickyLockPanel';
import { LOCK_MESSAGES, type StickyLockStateType } from '../../../../src/shared/contracts/locks';
import { createFakeBridge } from '../support/fake-bridge';
import { setupDom } from '../support/dom';
import { makeNote, testUuid } from '../support/services';

const PASSWORD = 'correct horse battery';
const PIN = '4821';

setupDom();
beforeEach(() => {
  vi.useFakeTimers();
});
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

/** The sticky window of a locked note whose key main holds (unlocked elsewhere) and whose PIN is set. */
async function lockedSticky(opts: { unlocked?: boolean; pin?: string | null } = {}) {
  const fake = createFakeBridge();
  const note = await makeNote(fake, undefined, 'Bank', true);
  fake.data.locks.locks.set(note.id, { password: PASSWORD, unlocked: opts.unlocked ?? true, hello: false, pin: opts.pin === undefined ? PIN : opts.pin });
  fake.data.notes.find((n) => n.id === note.id)!.locked = true;
  fake.data.floating.set(note.id, { collapsed: false, alwaysOnTop: false, activation: 1 });
  fake.data.setWindowState({ role: 'sticky', sticky: fake.stickyState(note.id) });
  const s = createStickyServices(fake.bridge, note.id, { themeEnv: null, lifecycle: null, randomUUID: testUuid });
  await s.ready;
  await vi.advanceTimersByTimeAsync(0);
  return { fake, note, s };
}

describe('a locked sticky window (D-172)', () => {
  it('starts blurred and never asks main for the text', async () => {
    const { fake, s } = await lockedSticky();
    expect(s.lock.getState().current).toMatchObject({ locked: true, revealed: false, keyInMemory: true, pinSet: true });
    expect(s.controller.store.getState()).toMatchObject({ status: 'locked', content: null });
    expect(fake.callsTo('note:open')).toHaveLength(0);
    expect(fake.callsTo('collab:join')).toHaveLength(0);
  });

  it('a PIN reveal opens the note; main blurring it drops the text and leaves live sync', async () => {
    const { fake, note, s } = await lockedSticky();
    expect(await s.lockActions.reveal({ kind: 'pin', pin: '0000' })).toBe(LOCK_MESSAGES.wrongPin);
    expect(s.controller.store.getState().status).toBe('locked');
    expect(await s.lockActions.reveal({ kind: 'pin', pin: PIN })).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.controller.store.getState()).toMatchObject({ status: 'ready' });
    expect(s.controller.store.getState().content).not.toBeNull();
    expect(fake.callsTo('collab:join')).toHaveLength(1);

    fake.emit('sticky:lockState', { ...s.lock.getState().current!, revealed: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.controller.store.getState()).toMatchObject({ status: 'locked', content: null, drafts: [] });
    expect(fake.callsTo('collab:leave')).toEqual([{ channel: 'collab:leave', req: { noteId: note.id, viewId: s.controller.viewId } }]);
  });

  it('after the key is dropped the PIN is refused and the password reveals it', async () => {
    const { fake, s } = await lockedSticky();
    await s.lockActions.reveal({ kind: 'pin', pin: PIN });
    await vi.advanceTimersByTimeAsync(0);
    await fake.bridge.lock.lockNow({ noteId: s.controller.noteId });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.lock.getState().current).toMatchObject({ revealed: false, keyInMemory: false });
    expect(s.controller.store.getState().status).toBe('locked');
    expect(await s.lockActions.reveal({ kind: 'pin', pin: PIN })).toBe(LOCK_MESSAGES.pinNeedsKey);
    expect(await s.lockActions.reveal({ kind: 'password', password: PASSWORD })).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.controller.store.getState().status).toBe('ready');
  });

  it('Blur now saves first, then main blurs it; the PIN can be set from the sticky', async () => {
    const { fake, s } = await lockedSticky({ pin: null });
    expect(await s.lockActions.reveal({ kind: 'password', password: PASSWORD })).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(await s.lockActions.setPin('wrong password', PIN)).toBe(LOCK_MESSAGES.wrongPassword);
    expect(await s.lockActions.setPin(PASSWORD, PIN)).toBeNull();
    expect(s.lock.getState().current?.pinSet).toBe(true);
    await s.lockActions.blur();
    await vi.advanceTimersByTimeAsync(0);
    const order = fake.calls.map((c) => c.channel).filter((c) => c === 'collab:flush' || c === 'sticky:blur');
    expect(order.at(-1)).toBe('sticky:blur');
    expect(s.controller.store.getState().status).toBe('locked');
  });

  it('reports interaction only while revealed, throttled', async () => {
    const { fake, s } = await lockedSticky();
    s.lockActions.activity();
    expect(fake.callsTo('sticky:activity')).toHaveLength(0);
    await s.lockActions.reveal({ kind: 'pin', pin: PIN });
    for (let i = 0; i < 20; i++) s.lockActions.activity();
    expect(fake.callsTo('sticky:activity')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.callsTo('sticky:activity')).toHaveLength(2);
  });

  it('follows the note being locked while it floats', async () => {
    const fake = createFakeBridge();
    const note = await makeNote(fake, undefined, 'Plain', true);
    fake.data.floating.set(note.id, { collapsed: false, alwaysOnTop: false, activation: 1 });
    fake.data.setWindowState({ role: 'sticky', sticky: fake.stickyState(note.id) });
    const s = createStickyServices(fake.bridge, note.id, { themeEnv: null, lifecycle: null, randomUUID: testUuid });
    await s.ready;
    await vi.advanceTimersByTimeAsync(0);
    expect(s.controller.store.getState().status).toBe('ready');
    await fake.bridge.lock.set({ noteId: note.id, password: PASSWORD, hello: false, acknowledged: true });
    fake.emit('sticky:state', fake.stickyState(note.id));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.lock.getState().current).toMatchObject({ locked: true, revealed: false });
    expect(s.controller.store.getState()).toMatchObject({ status: 'locked', content: null });
  });
});

describe('activity reporter', () => {
  it('sends the first report at once and folds the rest of the interval into one', async () => {
    const send = vi.fn();
    const reporter = createActivityReporter(send, { timers: { setTimeout, clearTimeout: (h) => clearTimeout(h as number) }, now: () => Date.now(), intervalMs: 1_000 });
    reporter.report();
    reporter.report();
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    reporter.report();
    expect(send).toHaveBeenCalledTimes(3);
    reporter.report();
    reporter.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe('the blurred sticky panel (D-172, D-173)', () => {
  const base: StickyLockStateType = {
    noteId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    locked: true,
    revealed: false,
    keyInMemory: true,
    pinSet: true,
    pinBlocked: false,
    hello: false,
    retryInSeconds: 0,
  };

  async function render(state: StickyLockStateType) {
    const reveal = vi.fn(async () => LOCK_MESSAGES.wrongPin as string | null);
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<StickyLockPanel state={state} actions={{ reveal, blur: vi.fn(), setPin: vi.fn(), activity: vi.fn() }} />));
    return { host, reveal };
  }

  it('shows a placeholder, no text, and asks for the PIN while the key is in memory', async () => {
    const { host, reveal } = await render(base);
    expect(host.querySelectorAll('.sticky-blur-line').length).toBeGreaterThan(3);
    expect(host.querySelector('.ProseMirror, textarea')).toBeNull();
    expect(host.textContent).toContain(STICKY_LOCK_TEXT.pin);
    const input = host.querySelector<HTMLInputElement>('input[placeholder="PIN"]')!;
    expect(input.inputMode).toBe('numeric');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '48a21');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(reveal).toHaveBeenCalledWith({ kind: 'pin', pin: '4821' });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(LOCK_MESSAGES.wrongPin);
  });

  it('asks for the password and says why when the key is gone or five PINs were wrong', async () => {
    let { host } = await render({ ...base, keyInMemory: false });
    expect(host.textContent).toContain(STICKY_LOCK_TEXT.keyGone);
    expect(host.querySelector('input[placeholder="Password"]')).not.toBeNull();
    act(() => root?.unmount());
    ({ host } = await render({ ...base, pinBlocked: true, hello: true }));
    expect(host.textContent).toContain(STICKY_LOCK_TEXT.pinBlocked);
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toContain('Use Windows Hello');
  });
});
