import fs from 'node:fs';
import { csvToWorkbook, detectDelimiter, encodeCsv, lineFormat, workbookToCsv } from './csv';
import { WorkbookLimitError, type WorkbookReply, type WorkbookTask } from './workbook-task';
import { readXlsx } from './xlsx-read';
import { writeXlsx } from './xlsx-write';

/** The length of a byte-order mark of each encoding. */
const BOM_BYTES = { 'utf-8': 3, 'utf-16le': 2, 'utf-16be': 2, 'windows-1252': 0 } as const;

/**
 * Runs one workbook task (D-134): the body of the workbook worker, and what tests call directly. A refusal by the
 * limits or the parser comes back as its code; nothing else about the file (no path, no message) does.
 */
export async function runWorkbookTask(task: WorkbookTask): Promise<WorkbookReply> {
  try {
    switch (task.op) {
      case 'readXlsx': {
        const { workbook, features } = await readXlsx(await fs.promises.readFile(task.file), task.limits);
        return { ok: true, read: { workbook, features, csv: null } };
      }
      case 'readCsv': {
        const bytes = await fs.promises.readFile(task.file);
        const { encoding, bom } = task.encoding;
        const text = new TextDecoder(encoding, { ignoreBOM: true }).decode(bytes.subarray(bom ? BOM_BYTES[encoding] : 0));
        const delimiter = detectDelimiter(text);
        return { ok: true, read: { workbook: csvToWorkbook(text, delimiter, task.limits), features: [], csv: { delimiter, encoding, bom, ...lineFormat(text) } } };
      }
      case 'writeXlsx':
        return { ok: true, bytes: await writeXlsx(task.workbook) };
      case 'writeCsv':
        return { ok: true, bytes: encodeCsv(workbookToCsv(task.workbook, task.format), task.format) };
    }
  } catch (err) {
    if (err instanceof WorkbookLimitError) return { ok: false, error: err.code };
    return { ok: false, error: task.op.startsWith('read') ? 'unreadable' : 'writeFailed' };
  }
}
