import type { CsvFormatType, WORKBOOK_LIMITS, WorkbookFeature, WorkbookType } from '../../../shared/documents/workbook';

/**
 * What the workbook worker is asked and answers (D-134). Only types live here: main's bundle and the worker share no
 * code, so the limits travel with each task.
 */
export type WorkbookLimits = { readonly [K in keyof typeof WORKBOOK_LIMITS]: number };

export type WorkbookTask =
  | { op: 'readXlsx'; file: string; limits: WorkbookLimits }
  /** CSV text is decoded with the encoding main found (its byte-order mark, else UTF-8 when valid, else Windows-1252). */
  | { op: 'readCsv'; file: string; limits: WorkbookLimits; encoding: Pick<CsvFormatType, 'encoding' | 'bom'> }
  | { op: 'writeXlsx'; workbook: WorkbookType }
  | { op: 'writeCsv'; workbook: WorkbookType; format: CsvFormatType };

/** Why a file cannot be edited as a workbook; main turns each into the user's message. */
export type WorkbookErrorCode = 'tooManySheets' | 'sheetTooLarge' | 'tooManyCells' | 'textTooLong' | 'unreadable' | 'writeFailed';

export interface ReadWorkbook {
  workbook: WorkbookType;
  /** What the file has that the model does not carry (shown before its first save). */
  features: WorkbookFeature[];
  /** How a CSV file was written, to write it back the same way; null for xlsx. */
  csv: CsvFormatType | null;
}

export type WorkbookReply =
  | { ok: true; read: ReadWorkbook }
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: WorkbookErrorCode | 'TIMEOUT' | 'EXITED' | 'CRASHED' };

/** A refusal of a file by the workbook limits or the parser. */
export class WorkbookLimitError extends Error {
  constructor(readonly code: WorkbookErrorCode) {
    super(code);
    this.name = 'WorkbookLimitError';
  }
}
