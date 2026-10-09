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
  const clock = { t: 1_000_000 };
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
    now: () => clock.t,
  });
  const beforeQuit = () => {
    let prevented = false;
    listeners.get('before-quit')!({ preventDefault: () => (prevented = true) });
    return prevented;
  };
  /** One Quit attempt, run until its flush answered. */
  const quitOnce = async () => {
    t.beforeQuit();
    await vi.advanceTimersByTimeAsync(0);
  };
  const t = { app, lifecycle, log, beforeQuit, answer, clock, quitOnce, canceled: () => log.filter((l) => l === 'quit-canceled').length };
  return t;
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

  it('F04-A1 (D-085): a canceled Quit lets only the next Quit within 2 minutes go ahead', async () => {
    const t = setup();
    t.answer.unsaved = [2];
    await t.quitOnce();
    expect(t.canceled()).toBe(1);
    t.clock.t += 119_000;
    await t.quitOnce();
    expect(t.canceled()).toBe(1);
    expect(t.app.quit).toHaveBeenCalledTimes(1);
  });

  it('F04-A1: after the escape expired, a Quit with unsaved text is canceled again and re-arms the escape', async () => {
    const t = setup();
    t.answer.unsaved = [2];
    await t.quitOnce();
    t.clock.t += 121_000;
    await t.quitOnce();
    expect(t.canceled()).toBe(2);
    expect(t.lifecycle.isQuitting()).toBe(false);
    expect(t.app.quit).not.toHaveBeenCalled();
    // The second cancel armed the escape again; an immediate further Quit exits.
    await t.quitOnce();
    expect(t.canceled()).toBe(2);
    expect(t.app.quit).toHaveBeenCalledTimes(1);
  });

  it('F04-A1: after a canceled Quit, a Quit whose flush saved everything exits without the escape', async () => {
    const t = setup();
    t.answer.unsaved = [2];
    await t.quitOnce();
    t.answer.unsaved = [];
    t.clock.t += 500_000;
    await t.quitOnce();
    expect(t.canceled()).toBe(1);
    expect(t.lifecycle.isQuitting()).toBe(true);
    expect(t.app.quit).toHaveBeenCalledTimes(1);
  });

  it('F04-A1: a session end after a canceled Quit never waits', async () => {
    const t = setup();
    t.answer.unsaved = [2];
    await t.quitOnce();
    t.lifecycle.windowHooks().onSessionEnd();
    expect(t.lifecycle.isQuitting()).toBe(true);
    expect(t.beforeQuit()).toBe(false);
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
