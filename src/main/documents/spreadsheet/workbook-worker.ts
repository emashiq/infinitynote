/**
 * The workbook worker thread (D-134): reads and writes xlsx and csv files for the spreadsheet editor, so parsing an
 * untrusted workbook never blocks main and a runaway file ends only this thread. It is its own build entry
 * (`out/main/workbook.js`) with ExcelJS bundled in, and shares no module with main's bundle.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { runWorkbookTask } from './workbook-convert';
import type { WorkbookTask } from './workbook-task';

void runWorkbookTask(workerData as WorkbookTask).then((reply) => {
  const transfer = 'bytes' in reply && reply.ok ? [reply.bytes.buffer as ArrayBuffer] : [];
  parentPort?.postMessage(reply, transfer);
});
