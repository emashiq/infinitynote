import type { FlushReasonType } from '../../shared/contracts/app';
import { SAVE_RETRIES, SAVE_RETRY_DELAY_MS } from '../../shared/contracts/notes';
import type { IdGenerator } from './ids';
import type { Logger } from './logger';

/**
 * How long a closing window or a quit waits for each renderer: long enough for the renderer to finish its save retries
 * and answer whether the text is saved (D-072), still bounded so a hung renderer cannot block quitting.
 */
export const FLUSH_TIMEOUT_MS = SAVE_RETRIES * SAVE_RETRY_DELAY_MS + 2000;

export interface FlushOutcome {
  /** Renderers that answered (whether or not their text is saved). */
  acked: number[];
  /** Renderers that answered that their text is not saved (a save failed and main kept no draft, D-072). */
  unsaved: number[];
  timedOut: number[];
}

/** True when every renderer answered in time that its text is saved. */
export function allSaved(outcome: FlushOutcome): boolean {
  return outcome.timedOut.length === 0 && outcome.unsaved.length === 0;
}

type Answer = 'saved' | 'unsaved' | 'timeout';

interface PendingFlush {
  webContentsId: number;
  done: (answer: Answer) => void;
}

/**
 * Acknowledged flush before a window closes or the app quits (INF-SAVE-01, D-055, D-072): sends `app:flush-request`
 * to each renderer and waits for its `app:flushed`, or at most `timeoutMs` per renderer, so a hung renderer cannot
 * block closing. Each answer says whether the renderer's text is saved.
 */
export class FlushCoordinator {
  private readonly pending = new Map<string, PendingFlush>();
  private readonly timeoutMs: number;

  constructor(
    private readonly deps: {
      sendTo: (webContentsId: number, flushId: string, reason: FlushReasonType) => void;
      ids: IdGenerator;
      logger: Logger;
      timeoutMs?: number;
    },
  ) {
    this.timeoutMs = deps.timeoutMs ?? FLUSH_TIMEOUT_MS;
  }

  async flush(webContentsIds: readonly number[], reason: FlushReasonType): Promise<FlushOutcome> {
    const results = await Promise.all(webContentsIds.map((id) => this.flushOne(id, reason).then((answer) => ({ id, answer }))));
    const ids = (pick: (a: Answer) => boolean) => results.filter((r) => pick(r.answer)).map((r) => r.id);
    const outcome = { acked: ids((a) => a !== 'timeout'), unsaved: ids((a) => a === 'unsaved'), timedOut: ids((a) => a === 'timeout') };
    this.deps.logger.info(
      `flush: requested=${webContentsIds.length} acked=${outcome.acked.length} timedOut=${outcome.timedOut.length} unsaved=${outcome.unsaved.length}`,
    );
    return outcome;
  }

  /** Records a renderer's answer. False for an unknown flush or one sent to a different renderer. */
  ack(webContentsId: number, flushId: string, saved: boolean): boolean {
    const entry = this.pending.get(flushId);
    if (!entry || entry.webContentsId !== webContentsId) return false;
    entry.done(saved ? 'saved' : 'unsaved');
    return true;
  }

  private flushOne(webContentsId: number, reason: FlushReasonType): Promise<Answer> {
    const flushId = this.deps.ids.uuid();
    return new Promise<Answer>((resolve) => {
      const timer = setTimeout(() => finish('timeout'), this.timeoutMs);
      const finish = (answer: Answer) => {
        clearTimeout(timer);
        this.pending.delete(flushId);
        resolve(answer);
      };
      this.pending.set(flushId, { webContentsId, done: finish });
      try {
        this.deps.sendTo(webContentsId, flushId, reason);
      } catch (err) {
        this.deps.logger.warn(`flush: could not reach renderer ${webContentsId}: ${String(err)}`);
        finish('timeout');
      }
    });
  }
}
