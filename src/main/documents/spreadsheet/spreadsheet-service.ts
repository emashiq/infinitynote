import fs from 'node:fs';
import { maxBytes } from '../../../shared/attachments/limits';
import type { DocumentOpenResponseType, DocumentReadWorkbookResponseType, DocumentSaveWorkbookRequestType } from '../../../shared/contracts/documents';
import { MAX_WORKBOOK_FILE_MB, Workbook, WORKBOOK_FEATURES, WORKBOOK_LIMITS, type CsvFormatType } from '../../../shared/documents/workbook';
import { WORKBOOK_MESSAGES } from '../../../shared/documents/workbook-messages';
import { DOCUMENT_MESSAGES } from '../../../shared/documents/messages';
import { AppError } from '../../services/app-error';
import type { Logger } from '../../services/logger';
import { isDocumentOfKind } from '../document-check';
import type { ResolvedDocumentFile } from '../document-files';
import type { DocumentService } from '../document-service';
import { bomEncoding, isUtf8 } from '../text-encoding';
import { packageFeatures } from './workbook-package';
import type { WorkbookConverter } from './workbook-runner';
import type { WorkbookReply, WorkbookTask } from './workbook-task';

export interface SpreadsheetServiceDeps {
  documents: Pick<DocumentService, 'fileOf' | 'save'>;
  convert: WorkbookConverter;
  logger: Logger;
}

const MAX_FILE_BYTES = maxBytes(MAX_WORKBOOK_FILE_MB);

/** The user's message for each reason the worker gives. */
const REPLY_ERRORS: Record<Extract<WorkbookReply, { ok: false }>['error'], { code: 'LIMIT_EXCEEDED' | 'VALIDATION_FAILED' | 'INTERNAL'; message: string }> = {
  tooManySheets: { code: 'LIMIT_EXCEEDED', message: WORKBOOK_MESSAGES.tooManySheets },
  sheetTooLarge: { code: 'LIMIT_EXCEEDED', message: WORKBOOK_MESSAGES.sheetTooLarge },
  tooManyCells: { code: 'LIMIT_EXCEEDED', message: WORKBOOK_MESSAGES.tooManyCells },
  textTooLong: { code: 'LIMIT_EXCEEDED', message: WORKBOOK_MESSAGES.textTooLong },
  unreadable: { code: 'VALIDATION_FAILED', message: WORKBOOK_MESSAGES.unreadable },
  writeFailed: { code: 'INTERNAL', message: WORKBOOK_MESSAGES.writeFailed },
  TIMEOUT: { code: 'LIMIT_EXCEEDED', message: WORKBOOK_MESSAGES.timedOut },
  EXITED: { code: 'VALIDATION_FAILED', message: WORKBOOK_MESSAGES.unreadable },
  CRASHED: { code: 'VALIDATION_FAILED', message: WORKBOOK_MESSAGES.unreadable },
};

/**
 * Spreadsheet documents for the grid editor (F3, D-134): an xlsx or csv file, current or a version, read into the
 * bounded workbook model in the workbook worker, and an edited model written back to file bytes there and saved as the
 * next revision through DocumentService (revision check, versions, linked originals, D-119). The model is validated
 * again here after the worker, so a parser fault cannot hand the renderer anything outside the contract.
 */
export class SpreadsheetService {
  constructor(private readonly deps: SpreadsheetServiceDeps) {}

  async read(documentId: string, versionId?: string): Promise<DocumentReadWorkbookResponseType> {
    const source = await this.deps.documents.fileOf(documentId, versionId);
    if (source.kind !== 'xlsx' && source.kind !== 'csv') throw new AppError('UNSUPPORTED', DOCUMENT_MESSAGES.noViewer(source.kind));
    if (source.sizeBytes > MAX_FILE_BYTES) throw new AppError('LIMIT_EXCEEDED', WORKBOOK_MESSAGES.tooLargeFile);
    if (!(await isDocumentOfKind(source.kind, source.file))) throw new AppError('VALIDATION_FAILED', WORKBOOK_MESSAGES.unreadable);
    const task: WorkbookTask =
      source.kind === 'xlsx'
        ? { op: 'readXlsx', file: source.file, limits: WORKBOOK_LIMITS }
        : { op: 'readCsv', file: source.file, limits: WORKBOOK_LIMITS, encoding: await csvEncoding(source) };
    const reply = await this.run(task, 'read');
    if (!('read' in reply)) throw new AppError('INTERNAL', WORKBOOK_MESSAGES.unreadable);
    const checked = Workbook.safeParse(reply.read.workbook);
    if (!checked.success) {
      this.deps.logger.warn(`spreadsheets: model check failed at=${checked.error.issues[0]?.path.join('.') ?? ''}`);
      throw new AppError('VALIDATION_FAILED', WORKBOOK_MESSAGES.unreadable);
    }
    const found = new Set([...reply.read.features, ...(source.kind === 'xlsx' ? await packageFeatures(source.file) : [])]);
    return { workbook: checked.data, simplified: WORKBOOK_FEATURES.filter((f) => found.has(f)), csv: reply.read.csv };
  }

  /** Writes the model in the document's own format and saves the bytes as its next revision. */
  async save(req: DocumentSaveWorkbookRequestType): Promise<DocumentOpenResponseType> {
    const { kind } = await this.deps.documents.fileOf(req.documentId);
    if (kind !== 'xlsx' && kind !== 'csv') throw new AppError('UNSUPPORTED', DOCUMENT_MESSAGES.noViewer(kind));
    if (kind === 'csv' && !req.csv) throw new AppError('VALIDATION_FAILED', 'Invalid request: csv');
    const task: WorkbookTask = kind === 'xlsx' ? { op: 'writeXlsx', workbook: req.workbook } : { op: 'writeCsv', workbook: req.workbook, format: req.csv as CsvFormatType };
    const reply = await this.run(task, 'write');
    if (!('bytes' in reply)) throw new AppError('INTERNAL', WORKBOOK_MESSAGES.writeFailed);
    return this.deps.documents.save({
      documentId: req.documentId,
      baseRevision: req.baseRevision,
      bytes: reply.bytes,
      ...(req.expectedFile ? { expectedFile: req.expectedFile } : {}),
    });
  }

  private async run(task: WorkbookTask, what: 'read' | 'write'): Promise<Extract<WorkbookReply, { ok: true }>> {
    const reply = await this.deps.convert(task);
    if (reply.ok) return reply;
    this.deps.logger.warn(`spreadsheets: ${what} failed op=${task.op} error=${reply.error}`);
    const { code, message } = REPLY_ERRORS[reply.error];
    throw new AppError(code, message);
  }
}

/**
 * The encoding of a CSV file (D-135): its byte-order mark, else UTF-8 when the whole file is valid UTF-8, else
 * Windows-1252 (what spreadsheet apps write on Western Windows systems).
 */
async function csvEncoding(source: ResolvedDocumentFile): Promise<Pick<CsvFormatType, 'encoding' | 'bom'>> {
  const bytes = await fs.promises.readFile(source.file);
  const bom = bomEncoding(bytes);
  if (bom) return { encoding: bom, bom: true };
  return { encoding: isUtf8(bytes) ? 'utf-8' : 'windows-1252', bom: false };
}
