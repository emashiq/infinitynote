import type { CapabilityStatusType } from '../../shared/contracts/app';
import type { DeliveryOutcomeType } from '../../shared/contracts/reminders';
import type { Clock } from './clock';
import { realTimers, type Timers } from './timers';

/** One OS notification (D-076): plain strings only, never actions, HTML or toast XML (D-026). */
export interface NotificationPayload {
  /** Identifies the alert in click and close callbacks: the delivery id. */
  ref: string;
  title: string;
  body: string;
}

export interface DeliveryOutcome {
  outcome: DeliveryOutcomeType;
  detail?: string;
}

export interface NotificationAdapter {
  show(payload: NotificationPayload): Promise<DeliveryOutcome>;
  onClick(cb: (ref: string) => void): () => void;
  onClose(cb: (ref: string) => void): () => void;
}

/** How long a shown notification may take to confirm before the outcome is `uncertain` (D-076). */
export const NOTIFY_CONFIRM_MS = 3_000;
export const MAX_DETAIL_CHARS = 200;

/**
 * Starts a notification and waits for its first answer: `show` → dispatched, `failed` or a throw → failed, nothing
 * within NOTIFY_CONFIRM_MS → uncertain. `start` must attach its listeners before showing, since a desktop without a
 * notification server reports the failure synchronously (planner probe).
 */
export function confirmShown(
  start: (settle: (outcome: DeliveryOutcome) => void) => void,
  timers: Timers = realTimers,
  ms = NOTIFY_CONFIRM_MS,
): Promise<DeliveryOutcome> {
  return new Promise((resolve) => {
    let done = false;
    let timer: unknown = null;
    const settle = (outcome: DeliveryOutcome) => {
      if (done) return;
      done = true;
      if (timer !== null) timers.clearTimeout(timer);
      resolve(outcome.detail ? { ...outcome, detail: outcome.detail.slice(0, MAX_DETAIL_CHARS) } : outcome);
    };
    try {
      start(settle);
    } catch (err) {
      settle({ outcome: 'failed', detail: err instanceof Error ? err.message : String(err) });
    }
    if (!done) timer = timers.setTimeout(() => settle({ outcome: 'uncertain', detail: 'no-show-event' }), ms);
  });
}

/** Where the desktop has no notification service the adapter is never called and the outcome is `unsupported`. */
export function capabilityGate(adapter: NotificationAdapter, capability: () => CapabilityStatusType): NotificationAdapter {
  return {
    show: (payload) => {
      const cap = capability();
      return cap.status === 'unsupported' ? Promise.resolve({ outcome: 'unsupported', detail: cap.reason }) : adapter.show(payload);
    },
    onClick: (cb) => adapter.onClick(cb),
    onClose: (cb) => adapter.onClose(cb),
  };
}

export type FakeNotifyMode = 'ok' | 'fail' | 'hang' | 'throw';

export interface ShownNotification {
  id: number;
  ref: string;
  title: string;
  body: string;
  at: number;
}

export interface FakeNotificationAdapter extends NotificationAdapter {
  mode: FakeNotifyMode;
  shown(): ShownNotification[];
  click(id: number): void;
  close(id: number): void;
  /** Confirms every notification still waiting in `hang` mode. */
  release(): void;
}

/**
 * The notification adapter of the integration tests and the E2E hooks (D-084): records what would be shown, and can
 * fail, hang (uncertain after NOTIFY_CONFIRM_MS unless released) or throw like Electron's Notification.
 */
export function createFakeNotificationAdapter(clock: Pick<Clock, 'now'>, timers?: Timers): FakeNotificationAdapter {
  const shown: ShownNotification[] = [];
  const clicks = new Set<(ref: string) => void>();
  const closes = new Set<(ref: string) => void>();
  const hanging: Array<() => void> = [];
  const listen = (set: Set<(ref: string) => void>) => (cb: (ref: string) => void) => {
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  };
  const refOf = (id: number) => {
    const n = shown.find((s) => s.id === id);
    if (!n) throw new Error(`no notification ${id}`);
    return n.ref;
  };
  const fake: FakeNotificationAdapter = {
    mode: 'ok',
    show(payload) {
      if (fake.mode === 'throw') throw new Error('Notification threw');
      return confirmShown((settle) => {
        if (fake.mode === 'fail') {
          settle({ outcome: 'failed', detail: 'test failure' });
          return;
        }
        shown.push({ id: shown.length + 1, ref: payload.ref, title: payload.title, body: payload.body, at: clock.now() });
        if (fake.mode === 'hang') hanging.push(() => settle({ outcome: 'dispatched' }));
        else settle({ outcome: 'dispatched' });
      }, timers);
    },
    onClick: listen(clicks),
    onClose: listen(closes),
    shown: () => [...shown],
    click(id) {
      const ref = refOf(id);
      for (const cb of [...clicks]) cb(ref);
    },
    close(id) {
      const ref = refOf(id);
      for (const cb of [...closes]) cb(ref);
    },
    release() {
      for (const settle of hanging.splice(0)) settle();
    },
  };
  return fake;
}
