import type { IdGenerator } from './ids';
import type { Logger } from './logger';

export const FLUSH_TIMEOUT_MS = 2000;

export interface FlushOutcome {
  acked: number[];
  timedOut: number[];
}

interface PendingFlush {
  webContentsId: number;
  done: (acked: boolean) => void;
}

/**
 * Acknowledged flush before a window closes or the app quits (INF-SAVE-01, D-055): sends `app:flush-request` to
 * each renderer and waits for its `app:flushed`, or at most `timeoutMs` per renderer, so a hung renderer cannot
 * block closing.
 */
export class FlushCoordinator {
  private readonly pending = new Map<string, PendingFlush>();
  private readonly timeoutMs: number;

  constructor(
    private readonly deps: {
      sendTo: (webContentsId: number, flushId: string) => void;
      ids: IdGenerator;
      logger: Logger;
      timeoutMs?: number;
    },
  ) {
    this.timeoutMs = deps.timeoutMs ?? FLUSH_TIMEOUT_MS;
  }

  async flush(webContentsIds: readonly number[]): Promise<FlushOutcome> {
    const results = await Promise.all(webContentsIds.map((id) => this.flushOne(id).then((acked) => ({ id, acked }))));
    const outcome = { acked: results.filter((r) => r.acked).map((r) => r.id), timedOut: results.filter((r) => !r.acked).map((r) => r.id) };
    this.deps.logger.info(`flush: requested=${webContentsIds.length} acked=${outcome.acked.length} timedOut=${outcome.timedOut.length}`);
    return outcome;
  }

  /** Records a renderer's acknowledgment. False for an unknown flush or one sent to a different renderer. */
  ack(webContentsId: number, flushId: string): boolean {
    const entry = this.pending.get(flushId);
    if (!entry || entry.webContentsId !== webContentsId) return false;
    entry.done(true);
    return true;
  }

  private flushOne(webContentsId: number): Promise<boolean> {
    const flushId = this.deps.ids.uuid();
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), this.timeoutMs);
      const finish = (acked: boolean) => {
        clearTimeout(timer);
        this.pending.delete(flushId);
        resolve(acked);
      };
      this.pending.set(flushId, { webContentsId, done: finish });
      try {
        this.deps.sendTo(webContentsId, flushId);
      } catch (err) {
        this.deps.logger.warn(`flush: could not reach renderer ${webContentsId}: ${String(err)}`);
        finish(false);
      }
    });
  }
}
