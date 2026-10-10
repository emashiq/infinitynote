import { Worker } from 'node:worker_threads';

export interface WorkerTaskOptions {
  /** A task still running after this long is stopped and fails with `TIMEOUT`. */
  timeoutMs: number;
  /** The worker's heap; a hostile file that wants more ends the worker, not the app. */
  heapMb: number;
}

/** A worker that failed without answering: the error's code or name, `TIMEOUT` or `EXITED`, never a message. */
function failure(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Runs one task in a new worker thread and resolves with its first message (D-129, D-134): parsing an untrusted file
 * never blocks main, a runaway task is stopped after the timeout, and a crash or memory exhaustion ends only the
 * worker. The worker is ended afterwards. Its console output is dropped, not mixed into the app's.
 */
export function runWorkerTask<Reply>(workerFile: string, workerData: unknown, options: WorkerTaskOptions): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData, resourceLimits: { maxOldGenerationSizeMb: options.heapMb }, stdout: true, stderr: true });
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      outcome();
    };
    const timer = setTimeout(() => finish(() => reject(failure('Worker timed out', 'TIMEOUT'))), options.timeoutMs);
    worker.once('message', (reply: Reply) => finish(() => resolve(reply)));
    worker.once('error', (err) => finish(() => reject(failure('Worker failed', (err as NodeJS.ErrnoException).code ?? err.name))));
    worker.once('exit', () => finish(() => reject(failure('Worker exited', 'EXITED'))));
  });
}
