export interface Store<S> {
  getState(): S;
  setState(updater: Partial<S> | ((prev: S) => S)): void;
  subscribe(listener: () => void): () => void;
}

/** Small external store. State objects are replaced immutably so useSyncExternalStore sees stable snapshots. */
export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(updater) {
      const next = typeof updater === 'function' ? updater(state) : { ...state, ...updater };
      if (next === state) return;
      state = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Outcome of a store action: callers show `message` when it fails. */
export type Outcome<T = undefined> = { ok: true; data: T } | { ok: false; code: string; message: string };

export function okOutcome<T>(data: T): Outcome<T> {
  return { ok: true, data };
}
export function failOutcome(code: string, message: string): Outcome<never> {
  return { ok: false, code, message };
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Debounce helper bound to injected timers; `flushNow` runs the pending call immediately. */
export function createDebouncer(timers: Timers, ms: number, fn: () => void) {
  let handle: unknown = null;
  return {
    schedule() {
      if (handle !== null) timers.clearTimeout(handle);
      handle = timers.setTimeout(() => {
        handle = null;
        fn();
      }, ms);
    },
    cancel() {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
    },
    pending: () => handle !== null,
    flushNow() {
      if (handle !== null) {
        timers.clearTimeout(handle);
        handle = null;
        fn();
      }
    },
  };
}

export function uuidv4(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
