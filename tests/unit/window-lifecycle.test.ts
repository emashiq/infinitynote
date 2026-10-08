import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlushOutcome } from '../../src/main/services/flush-coordinator';
import { memoryLogger } from '../../src/main/services/logger';
import { createWindowLifecycle } from '../../src/main/window-lifecycle';
import { WindowRegistry } from '../../src/main/windows/window-registry';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const listeners = new Map<string, (event: { preventDefault(): void }) => void>();
  const app = { on: vi.fn((name: string, cb: (event: { preventDefault(): void }) => void) => listeners.set(name, cb)), quit: vi.fn() };
  const registry = new WindowRegistry();
  for (const id of [1, 2]) registry.add({ webContentsId: id, role: 'main', send: () => {}, isDestroyed: () => false });
  const log: string[] = [];
  const answer = { unsaved: [] as number[] };
  const lifecycle = createWindowLifecycle({
    app: app as never,
    registry,
    logger: memoryLogger(),
    flush: async (ids, reason): Promise<FlushOutcome> => {
      log.push(`flush:${ids.join(',')}:${reason}`);
      return { acked: ids, unsaved: answer.unsaved, timedOut: [] };
    },
    resetLeases: (id) => log.push(`reset:${id}`),
    onQuitStarting: () => log.push('quit-starting'),
    onQuitCanceled: () => log.push('quit-canceled'),
  });
  const beforeQuit = () => {
    let prevented = false;
    listeners.get('before-quit')!({ preventDefault: () => (prevented = true) });
    return prevented;
  };
  return { app, lifecycle, log, beforeQuit, answer };
}

describe('window lifecycle (plan section 8.10)', () => {
  it('quit saves window state first, flushes every window once, then quits', async () => {
    const t = setup();
    expect(t.beforeQuit()).toBe(true);
    expect(t.beforeQuit()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.log).toEqual(['quit-starting', 'flush:1,2:quit']);
    expect(t.lifecycle.isQuitting()).toBe(true);
    expect(t.app.quit).toHaveBeenCalledTimes(1);
    expect(t.beforeQuit()).toBe(false);
  });

  it('the first quit is canceled when a window could not save; a repeated quit goes ahead (D-072)', async () => {
    const t = setup();
    t.answer.unsaved = [2];
    expect(t.beforeQuit()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.log).toEqual(['quit-starting', 'flush:1,2:quit', 'quit-canceled']);
    expect(t.lifecycle.isQuitting()).toBe(false);
    expect(t.app.quit).not.toHaveBeenCalled();
    expect(t.beforeQuit()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.log.slice(3)).toEqual(['quit-starting', 'flush:1,2:quit']);
    expect(t.lifecycle.isQuitting()).toBe(true);
    expect(t.app.quit).toHaveBeenCalledTimes(1);
  });

  it('a session end marks quitting without a flush or a dialog', () => {
    const t = setup();
    t.lifecycle.windowHooks().onSessionEnd();
    t.lifecycle.windowHooks().onSessionEnd();
    expect(t.lifecycle.isQuitting()).toBe(true);
    expect(t.log).toEqual(['quit-starting']);
    expect(t.beforeQuit()).toBe(false);
  });

  it('crash reloads are counted per window (at most 3 a minute each)', async () => {
    const t = setup();
    const a = t.lifecycle.windowHooks();
    const b = t.lifecycle.windowHooks();
    const reloadA = vi.fn();
    const reloadB = vi.fn();
    for (let i = 0; i < 4; i += 1) a.onRendererGone(1, 'crashed', reloadA);
    b.onRendererGone(2, 'crashed', reloadB);
    await vi.advanceTimersByTimeAsync(500);
    expect(reloadA).toHaveBeenCalledTimes(3);
    expect(reloadB).toHaveBeenCalledTimes(1);
    a.onRendererGone(1, 'clean-exit', reloadA);
    expect(t.log.filter((l) => l === 'reset:1')).toHaveLength(5);
  });
});
