/**
 * PDF text for the search index (D-129). This module is the entry of the worker thread that reads it, so it imports
 * only Node built-ins and pdf.js (values; types are erased): the build bundles it as its own file, Node runs it directly
 * under test, and main never loads pdf.js itself.
 */
import fs from 'node:fs';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

export interface PdfTextLimits {
  /** Pages read, from the first. */
  maxPages: number;
  /** Characters kept; reading stops once they are reached. */
  maxChars: number;
}

/** What the worker is started with. */
export interface PdfTextTask {
  file: string;
  /** Larger files are not read at all. */
  maxFileBytes: number;
  /** The directory of pdf.js character maps, for fonts that need them. */
  cMapDir: string;
  limits: PdfTextLimits;
}

export type PdfTextReply = { ok: true; text: string } | { ok: false; error: string };

// pdf.js runs its parser in this thread (no nested worker): it looks for the worker module on globalThis.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
}

/**
 * The text of a PDF's pages in reading order: one line per text line pdf.js reports, a blank line between pages.
 * Stops at the page or character limit. A PDF that needs a password throws (its text is never indexed, D-129).
 */
export async function extractPdfText(data: Uint8Array, limits: PdfTextLimits, cMapDir?: string): Promise<string> {
  const task = getDocument({
    data,
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
    // pdf.js wants a directory "URL" with forward slashes and a trailing slash, also for a file path.
    ...(cMapDir ? { cMapUrl: cMapDir.replaceAll('\\', '/').replace(/\/?$/, '/'), cMapPacked: true } : {}),
  });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    let length = 0;
    const last = Math.min(pdf.numPages, limits.maxPages);
    for (let n = 1; n <= last && length < limits.maxChars; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = (content.items as TextItemLike[])
        .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ''))
        .join('')
        .trim();
      page.cleanup();
      if (text) {
        pages.push(text);
        length += text.length;
      }
    }
    return pages.join('\n\n');
  } finally {
    await task.destroy();
  }
}

async function runTask(job: PdfTextTask): Promise<PdfTextReply> {
  try {
    const stat = await fs.promises.stat(job.file);
    if (stat.size > job.maxFileBytes) return { ok: false, error: 'TooLarge' };
    const data = new Uint8Array(await fs.promises.readFile(job.file));
    return { ok: true, text: await extractPdfText(data, job.limits, job.cMapDir) };
  } catch (err) {
    // Only a file system code or the error's name goes back: messages may name the file. pdf.js codes are numbers.
    const code = (err as { code?: unknown }).code;
    return { ok: false, error: typeof code === 'string' ? code : ((err as Error).name ?? 'Error') };
  }
}

function isTask(data: unknown): data is PdfTextTask {
  const task = data as Partial<PdfTextTask> | null;
  return typeof task?.file === 'string' && typeof task.maxFileBytes === 'number' && typeof task.limits?.maxPages === 'number';
}

if (!isMainThread && parentPort && isTask(workerData)) {
  const port = parentPort;
  void runTask(workerData as PdfTextTask).then((reply) => port.postMessage(reply));
}
