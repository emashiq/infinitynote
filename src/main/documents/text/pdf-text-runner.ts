import { maxBytes } from '../../../shared/attachments/limits';
import { MAX_DOCUMENT_TEXT_CHARS, MAX_PDF_TEXT_FILE_MB, MAX_PDF_TEXT_PAGES } from '../../../shared/documents/limits';
import { runWorkerTask } from '../../services/worker-task';
import type { DocumentTextExtractor } from './document-text';
// Types only: a value import would pull pdf.js into main's own bundle.
import type { PdfTextReply, PdfTextTask } from './pdf-text';

export interface PdfTextWorkerOptions {
  /** The built `pdf-text.js` (or, under test, `pdf-text.ts`, which Node runs with type stripping). */
  workerFile: string;
  /** The directory of the pdf.js character maps shipped with the app. */
  cMapDir: string;
  timeoutMs?: number;
}

/** A PDF whose text takes longer than this is indexed by its title only. */
const DEFAULT_TIMEOUT_MS = 60_000;
const WORKER_HEAP_MB = 512;

/**
 * Reads PDF text in a worker thread (D-129), one worker per file. A refusal by pdf.js rejects with its error name
 * as the code (`PasswordException`, `InvalidPDFException`, `ENOENT`).
 */
export function createPdfTextExtractor(options: PdfTextWorkerOptions): DocumentTextExtractor {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (file) => {
    const job: PdfTextTask = {
      file,
      maxFileBytes: maxBytes(MAX_PDF_TEXT_FILE_MB),
      cMapDir: options.cMapDir,
      limits: { maxPages: MAX_PDF_TEXT_PAGES, maxChars: MAX_DOCUMENT_TEXT_CHARS },
    };
    const reply = await runWorkerTask<PdfTextReply>(options.workerFile, job, { timeoutMs, heapMb: WORKER_HEAP_MB });
    if (!reply.ok) throw Object.assign(new Error('PDF text failed'), { code: reply.error });
    return reply.text;
  };
}
