import { runWorkerTask } from '../../services/worker-task';
// Types only: the worker's modules (and ExcelJS) stay out of main's own bundle.
import type { WorkbookReply, WorkbookTask } from './workbook-task';

/** Runs a workbook task: in a worker thread in the app, directly in tests. */
export type WorkbookConverter = (task: WorkbookTask) => Promise<WorkbookReply>;

/** Reading or writing a workbook that takes longer than this is stopped. */
const TIMEOUT_MS = 120_000;
/** A 25 MB package can hold several hundred MB of XML; ExcelJS keeps the whole workbook in memory. */
const WORKER_HEAP_MB = 2048;

/** A converter that starts the built workbook worker (`out/main/workbook.js`) for each task (D-134). */
export function createWorkbookConverter(options: { workerFile: string; timeoutMs?: number }): WorkbookConverter {
  return (task) =>
    runWorkerTask<WorkbookReply>(options.workerFile, task, { timeoutMs: options.timeoutMs ?? TIMEOUT_MS, heapMb: WORKER_HEAP_MB }).catch(
      (err: NodeJS.ErrnoException): WorkbookReply => ({ ok: false, error: err.code === 'TIMEOUT' ? 'TIMEOUT' : err.code === 'EXITED' ? 'EXITED' : 'CRASHED' }),
    );
}
