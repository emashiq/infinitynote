/** OS power events the scheduler and locked notes listen to; implemented over Electron's powerMonitor by electron-power.ts. */
export type PowerEvent = 'resume' | 'suspend' | 'lock-screen' | 'unlock-screen';

export interface PowerEvents {
  on(event: PowerEvent, cb: () => void): () => void;
}

/** Power events a test emits (integration tests and the E2E power hook, D-084). */
export function createFakePowerEvents(): PowerEvents & { emit(event: PowerEvent): void; listenerCount(): number } {
  const listeners = new Map<PowerEvent, Set<() => void>>();
  return {
    on(event, cb) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },
    emit(event) {
      for (const cb of [...(listeners.get(event) ?? [])]) cb();
    },
    listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}
