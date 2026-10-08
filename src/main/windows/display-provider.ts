import type { Screen } from 'electron';
import type { DisplayInfo } from './display-clamp';

/** The connected displays and their changes (ARCHITECTURE section 15 seam). */
export interface DisplayProvider {
  all(): DisplayInfo[];
  primaryId(): number;
  /** Calls back after a display was added, removed or changed its metrics; returns the unsubscribe function. */
  onChanged(cb: () => void): () => void;
  /** Number of change subscriptions (listener-leak checks). */
  listenerCount(): number;
}

const SCREEN_EVENTS = ['display-added', 'display-removed', 'display-metrics-changed'] as const;

export function createElectronDisplayProvider(screen: Screen): DisplayProvider {
  return {
    all: () => screen.getAllDisplays().map((d) => ({ id: d.id, bounds: { ...d.bounds }, workArea: { ...d.workArea } })),
    primaryId: () => screen.getPrimaryDisplay().id,
    onChanged(cb) {
      const listener = () => cb();
      for (const event of SCREEN_EVENTS) screen.on(event as 'display-added', listener);
      return () => {
        for (const event of SCREEN_EVENTS) screen.removeListener(event as 'display-added', listener);
      };
    },
    listenerCount: () => screen.listenerCount('display-removed'),
  };
}

export interface FakeDisplays {
  displays: DisplayInfo[];
  primaryId: number;
}

/** A display set the E2E hooks and Node tests replace at will; `set` emits a change. */
export function createFakeDisplayProvider(initial: FakeDisplays): DisplayProvider & { set(displays: DisplayInfo[], primaryId: number): void } {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    all: () => current.displays.map((d) => ({ id: d.id, bounds: { ...d.bounds }, workArea: { ...d.workArea } })),
    primaryId: () => current.primaryId,
    onChanged(cb) {
      const listener = () => cb();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listenerCount: () => listeners.size,
    set(displays, primaryId) {
      current = { displays, primaryId };
      for (const l of [...listeners]) l();
    },
  };
}
