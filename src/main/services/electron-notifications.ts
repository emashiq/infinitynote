import type { NotificationConstructorOptions } from 'electron';
import { confirmShown, type NotificationAdapter, type NotificationPayload } from './notification-adapter';
import type { Timers } from './timers';

/** The part of Electron's Notification the adapter uses. */
export interface NotificationLike {
  on(event: 'show' | 'click' | 'close', listener: () => void): unknown;
  on(event: 'failed', listener: (event: unknown, error: string) => void): unknown;
  show(): void;
}

export type NotificationClass = new (options: NotificationConstructorOptions) => NotificationLike;

/** Shown notifications are referenced until closed, so their click events survive garbage collection. */
export const MAX_KEPT_NOTIFICATIONS = 50;

/**
 * Plain title and body only (D-026, D-076): no actions, no reply field and no toast XML, so nothing in a notification
 * can be a button whose absence breaks a desktop. Linux gets the app icon; Windows takes it from the AUMID shortcut.
 */
export function notificationOptions(payload: NotificationPayload, opts: { platform: NodeJS.Platform; iconPath: string }): NotificationConstructorOptions {
  return { title: payload.title, body: payload.body, silent: false, ...(opts.platform === 'linux' ? { icon: opts.iconPath } : {}) };
}

/** The notification adapter over Electron's Notification class (D-076). */
export function createElectronNotificationAdapter(deps: {
  NotificationClass: NotificationClass;
  platform: NodeJS.Platform;
  iconPath: string;
  timers?: Timers;
}): NotificationAdapter {
  const kept = new Map<string, NotificationLike>();
  const clicks = new Set<(ref: string) => void>();
  const closes = new Set<(ref: string) => void>();
  const keep = (ref: string, n: NotificationLike) => {
    kept.set(ref, n);
    while (kept.size > MAX_KEPT_NOTIFICATIONS) kept.delete(kept.keys().next().value!);
  };
  const listen = (set: Set<(ref: string) => void>) => (cb: (ref: string) => void) => {
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  };
  return {
    show(payload) {
      return confirmShown((settle) => {
        const n = new deps.NotificationClass(notificationOptions(payload, deps));
        // Listeners first: without a notification server Linux reports the failure synchronously inside show().
        n.on('show', () => settle({ outcome: 'dispatched' }));
        n.on('failed', (_event, error) => settle({ outcome: 'failed', detail: String(error) }));
        n.on('click', () => {
          for (const cb of [...clicks]) cb(payload.ref);
        });
        n.on('close', () => {
          kept.delete(payload.ref);
          for (const cb of [...closes]) cb(payload.ref);
        });
        keep(payload.ref, n);
        n.show();
      }, deps.timers);
    },
    onClick: listen(clicks),
    onClose: listen(closes),
  };
}
