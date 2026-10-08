import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlushCoordinator } from '../../src/main/services/flush-coordinator';
import { memoryLogger } from '../../src/main/services/logger';
import { randomIds } from './helpers';

function setup() {
  const sent: Array<{ webContentsId: number; flushId: string }> = [];
  const logger = memoryLogger();
  const coordinator = new FlushCoordinator({ sendTo: (webContentsId, flushId) => sent.push({ webContentsId, flushId }), ids: randomIds(), logger });
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
    const pending = s.coordinator.flush([7]).then((r) => {
      done = true;
      return r;
    });
    expect(s.sent).toEqual([{ webContentsId: 7, flushId: expect.any(String) }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    expect(s.coordinator.ack(7, s.sent[0]!.flushId)).toBe(true);
    expect(await pending).toEqual({ acked: [7], timedOut: [] });
    expect(s.logger.lines).toContain('INFO flush: requested=1 acked=1 timedOut=0');
  });

  it('a renderer that never answers costs at most 2000 ms', async () => {
    const s = setup();
    let result: unknown = null;
    void s.coordinator.flush([3]).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(1999);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ acked: [], timedOut: [3] });
    expect(s.logger.lines).toContain('INFO flush: requested=1 acked=0 timedOut=1');
    // A late ack after the timeout is refused.
    expect(s.coordinator.ack(3, s.sent[0]!.flushId)).toBe(false);
  });

  it('wrong sender and unknown flush ids are refused', async () => {
    const s = setup();
    const pending = s.coordinator.flush([5]);
    const { flushId } = s.sent[0]!;
    expect(s.coordinator.ack(6, flushId)).toBe(false);
    expect(s.coordinator.ack(5, '00000000-0000-4000-8000-000000000000')).toBe(false);
    expect(s.coordinator.ack(5, flushId)).toBe(true);
    expect(s.coordinator.ack(5, flushId)).toBe(false);
    expect(await pending).toEqual({ acked: [5], timedOut: [] });
  });

  it('several windows are flushed in parallel, each with its own id and timeout', async () => {
    const s = setup();
    let result: unknown = null;
    void s.coordinator.flush([1, 2, 3]).then((r) => (result = r));
    expect(new Set(s.sent.map((x) => x.flushId)).size).toBe(3);
    s.coordinator.ack(1, s.sent[0]!.flushId);
    s.coordinator.ack(3, s.sent[2]!.flushId);
    await vi.advanceTimersByTimeAsync(2000);
    expect(result).toEqual({ acked: [1, 3], timedOut: [2] });
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
    expect(await coordinator.flush([9])).toEqual({ acked: [], timedOut: [9] });
  });

  it('nothing to flush resolves immediately', async () => {
    const s = setup();
    expect(await s.coordinator.flush([])).toEqual({ acked: [], timedOut: [] });
  });
});
