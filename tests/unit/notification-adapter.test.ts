import type { NotificationConstructorOptions } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectCapabilities } from '../../src/main/services/capabilities';
import { createElectronNotificationAdapter, MAX_KEPT_NOTIFICATIONS, notificationOptions, type NotificationLike } from '../../src/main/services/electron-notifications';
import { capabilityGate, createFakeNotificationAdapter, NOTIFY_CONFIRM_MS } from '../../src/main/services/notification-adapter';

type Behavior = 'show' | 'show-later' | 'failed-sync' | 'throw' | 'silent';

/** A stand-in for Electron's Notification class that records its options and plays one behavior. */
function fakeNotificationClass(behavior: { current: Behavior }) {
  const created: Array<{ options: NotificationConstructorOptions; emit(event: string): void }> = [];
  class FakeNotification implements NotificationLike {
    private readonly listeners = new Map<string, (event: unknown, error: string) => void>();
    constructor(options: NotificationConstructorOptions) {
      created.push({ options, emit: (event) => this.listeners.get(event)?.({}, 'emitted') });
    }
    on(event: string, listener: (event: unknown, error: string) => void): unknown {
      this.listeners.set(event, listener);
      return this;
    }
    show(): void {
      if (behavior.current === 'throw') throw new Error('toast platform unavailable');
      if (behavior.current === 'failed-sync') this.listeners.get('failed')?.({}, 'GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown');
      if (behavior.current === 'show') this.listeners.get('show')?.({}, '');
      if (behavior.current === 'show-later') setTimeout(() => this.listeners.get('show')?.({}, ''), 10);
    }
  }
  return { FakeNotification, created };
}

const payload = { ref: 'delivery-1', title: 'Submit report', body: 'Due Fri 9 Oct, 17:00 · Report' };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Electron notification adapter (D-076, INF-REM-16)', () => {
  function setup(initial: Behavior, platform: NodeJS.Platform = 'win32') {
    const behavior = { current: initial };
    const { FakeNotification, created } = fakeNotificationClass(behavior);
    const adapter = createElectronNotificationAdapter({ NotificationClass: FakeNotification, platform, iconPath: '/app/icon.png' });
    return { behavior, adapter, created };
  }

  it('maps show to dispatched, also when it arrives later within the confirmation time', async () => {
    const { adapter, behavior } = setup('show');
    await expect(adapter.show(payload)).resolves.toEqual({ outcome: 'dispatched' });
    behavior.current = 'show-later';
    const later = adapter.show(payload);
    await vi.advanceTimersByTimeAsync(10);
    await expect(later).resolves.toEqual({ outcome: 'dispatched' });
  });

  it('a synchronous failed event (no notification server) and a throw are failures with the error text', async () => {
    const { adapter, behavior } = setup('failed-sync', 'linux');
    await expect(adapter.show(payload)).resolves.toEqual({ outcome: 'failed', detail: 'GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown' });
    behavior.current = 'throw';
    await expect(adapter.show(payload)).resolves.toEqual({ outcome: 'failed', detail: 'toast platform unavailable' });
  });

  it('no answer within 3000 ms is uncertain', async () => {
    const { adapter } = setup('silent');
    const result = adapter.show(payload);
    await vi.advanceTimersByTimeAsync(NOTIFY_CONFIRM_MS - 1);
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ outcome: 'uncertain', detail: 'no-show-event' });
  });

  it('options carry no actions, reply or toast XML; Linux gets the icon', () => {
    const win = notificationOptions(payload, { platform: 'win32', iconPath: '/i.png' });
    expect(win).toEqual({ title: 'Submit report', body: 'Due Fri 9 Oct, 17:00 · Report', silent: false });
    const linux = notificationOptions(payload, { platform: 'linux', iconPath: '/i.png' });
    expect(linux).toEqual({ ...win, icon: '/i.png' });
    for (const key of ['actions', 'toastXml', 'hasReply', 'replyPlaceholder', 'closeButtonText']) {
      expect(win, key).not.toHaveProperty(key);
      expect(linux, key).not.toHaveProperty(key);
    }
    expect(detectCapabilities({ platform: 'win32', isPackaged: false, ozonePlatform: null, xdgSessionType: null, waylandDisplay: null, display: null, wslDistro: null, wslgVersion: null, statusNotifierHost: null, notificationServer: null }).notificationActions).toEqual({
      status: 'unsupported',
      reason: 'not-promised-on-all-desktops',
    });
  });

  it('clicks and closes report the payload ref; at most 50 notifications are kept', async () => {
    const { adapter, created } = setup('show');
    const clicked: string[] = [];
    const closed: string[] = [];
    const offClick = adapter.onClick((ref) => clicked.push(ref));
    adapter.onClose((ref) => closed.push(ref));
    await adapter.show(payload);
    created[0]!.emit('click');
    created[0]!.emit('close');
    offClick();
    created[0]!.emit('click');
    expect(clicked).toEqual(['delivery-1']);
    expect(closed).toEqual(['delivery-1']);
    expect(MAX_KEPT_NOTIFICATIONS).toBe(50);
  });
});

describe('capability gate and fake adapter', () => {
  it('an unsupported capability answers unsupported without calling the adapter', async () => {
    const inner = createFakeNotificationAdapter({ now: () => 5 });
    const show = vi.spyOn(inner, 'show');
    const gated = capabilityGate(inner, () => ({ status: 'unsupported', reason: 'no-notification-server' }));
    await expect(gated.show(payload)).resolves.toEqual({ outcome: 'unsupported', detail: 'no-notification-server' });
    expect(show).not.toHaveBeenCalled();
    const open = capabilityGate(inner, () => ({ status: 'unknown', reason: 'notification-server-unknown' }));
    await expect(open.show(payload)).resolves.toEqual({ outcome: 'dispatched' });
    expect(inner.shown()).toEqual([{ id: 1, ...payload, at: 5 }]);
  });

  it('fake modes: fail, throw and hang (released or timed out)', async () => {
    const fake = createFakeNotificationAdapter({ now: () => 1 });
    fake.mode = 'fail';
    await expect(fake.show(payload)).resolves.toEqual({ outcome: 'failed', detail: 'test failure' });
    fake.mode = 'throw';
    expect(() => fake.show(payload)).toThrow('Notification threw');
    fake.mode = 'hang';
    const released = fake.show(payload);
    fake.release();
    await expect(released).resolves.toEqual({ outcome: 'dispatched' });
    const timedOut = fake.show(payload);
    await vi.advanceTimersByTimeAsync(NOTIFY_CONFIRM_MS);
    await expect(timedOut).resolves.toEqual({ outcome: 'uncertain', detail: 'no-show-event' });
  });
});
