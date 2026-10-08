import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLUSH_TIMEOUT_MS, FlushCoordinator, allSaved } from '../../src/main/services/flush-coordinator';
import { memoryLogger } from '../../src/main/services/logger';
import { randomIds } from './helpers';

function setup() {
  const sent: Array<{ webContentsId: number; flushId: string; reason: string }> = [];
  const logger = memoryLogger();
  const coordinator = new FlushCoordinator({ sendTo: (webContentsId, flushId, reason) => sent.push({ webContentsId, flushId, reason }), ids: randomIds(), logger });
  return { sent, logger, coordinator };
}

describe('FlushCoordinator (INF-SAVE-01, D-055)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ack: resolves as soon as the renderer acknowledges and logs the counts', async () => {
    const s = setup();
    let done = false;
    const pending = s.coordinator.flush([7], 'close').then((r) => {
      done = true;
      return r;
    });
    expect(s.sent).toEqual([{ webContentsId: 7, flushId: expect.any(String), reason: 'close' }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    expect(s.coordinator.ack(7, s.sent[0]!.flushId, true)).toBe(true);
    expect(await pending).toEqual({ acked: [7], unsaved: [], timedOut: [] });
    expect(s.logger.lines).toContain('INFO flush: requested=1 acked=1 timedOut=0 unsaved=0');
  });

  it('a renderer that never answers costs at most the flush wait (5000 ms, covering the save retries)', async () => {
    expect(FLUSH_TIMEOUT_MS).toBe(5000);
    const s = setup();
    let result: unknown = null;
    void s.coordinator.flush([3], 'close').then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(4999);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ acked: [], unsaved: [], timedOut: [3] });
    expect(s.logger.lines).toContain('INFO flush: requested=1 acked=0 timedOut=1 unsaved=0');
    // A late ack after the timeout is refused.
    expect(s.coordinator.ack(3, s.sent[0]!.flushId, true)).toBe(false);
  });

  it('wrong sender and unknown flush ids are refused', async () => {
    const s = setup();
    const pending = s.coordinator.flush([5], 'close');
    const { flushId } = s.sent[0]!;
    expect(s.coordinator.ack(6, flushId, true)).toBe(false);
    expect(s.coordinator.ack(5, '00000000-0000-4000-8000-000000000000', true)).toBe(false);
    expect(s.coordinator.ack(5, flushId, true)).toBe(true);
    expect(s.coordinator.ack(5, flushId, true)).toBe(false);
    expect(await pending).toEqual({ acked: [5], unsaved: [], timedOut: [] });
  });

  it('several windows are flushed in parallel, each with its own id and timeout', async () => {
    const s = setup();
    let result: unknown = null;
    void s.coordinator.flush([1, 2, 3], 'close').then((r) => (result = r));
    expect(new Set(s.sent.map((x) => x.flushId)).size).toBe(3);
    s.coordinator.ack(1, s.sent[0]!.flushId, true);
    s.coordinator.ack(3, s.sent[2]!.flushId, true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(result).toEqual({ acked: [1, 3], unsaved: [], timedOut: [2] });
  });

  it('a renderer that cannot be reached counts as timed out at once', async () => {
    const logger = memoryLogger();
    const coordinator = new FlushCoordinator({
      sendTo: () => {
        throw new Error('destroyed');
      },
      ids: randomIds(),
      logger,
    });
    expect(await coordinator.flush([9], 'close')).toEqual({ acked: [], unsaved: [], timedOut: [9] });
  });

  it('nothing to flush resolves immediately', async () => {
    const s = setup();
    expect(await s.coordinator.flush([], 'close')).toEqual({ acked: [], unsaved: [], timedOut: [] });
  });

  it('a renderer that answers its text is not saved is reported as unsaved (D-072)', async () => {
    const s = setup();
    const pending = s.coordinator.flush([1, 2], 'quit');
    expect(s.sent.map((x) => x.reason)).toEqual(['quit', 'quit']);
    s.coordinator.ack(1, s.sent[0]!.flushId, false);
    s.coordinator.ack(2, s.sent[1]!.flushId, true);
    const outcome = await pending;
    expect(outcome).toEqual({ acked: [1, 2], unsaved: [1], timedOut: [] });
    expect(allSaved(outcome)).toBe(false);
    expect(allSaved({ acked: [2], unsaved: [], timedOut: [] })).toBe(true);
    expect(allSaved({ acked: [], unsaved: [], timedOut: [2] })).toBe(false);
    expect(s.logger.lines).toContain('INFO flush: requested=2 acked=2 timedOut=0 unsaved=1');
  });
});
