import { degrees, PDFDocument } from 'pdf-lib';

/**
 * Page operations on PDF bytes with pdf-lib (F2, D-131). Each takes the current bytes (annotations already written in
 * by pdf.js) and returns new bytes; the document keeps everything else it had (outline, metadata, forms), because pages
 * are moved within the same file rather than copied into a new one. Page indices are 0-based.
 */

export const PDF_PAGE_MESSAGES = {
  protected: 'Pages of a password-protected PDF cannot be changed in Infinity Notes.',
  otherProtected: 'That PDF is password-protected, so its pages cannot be inserted.',
  otherUnreadable: 'That file is not a readable PDF.',
  lastPage: 'A PDF needs at least one page, so the last page cannot be deleted.',
  unreadable: 'This PDF could not be changed.',
} as const;

export class PdfPageError extends Error {}

/** US Letter, for a blank page in a document without pages to take a size from. */
const DEFAULT_PAGE_SIZE: [number, number] = [612, 792];

async function load(bytes: Uint8Array, refusal: { protected: string; unreadable: string } = PDF_PAGE_MESSAGES): Promise<PDFDocument> {
  let pdf: PDFDocument;
  try {
    // The metadata stays as it was: changing pages is not a new producer or creation of the file. An encrypted file is
    // loaded only to be recognized (pdf-lib cannot write one) and then refused.
    pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    // pdf-lib reads a file without a page tree leniently; asking for its pages finds out.
    pdf.getPageCount();
  } catch {
    throw new PdfPageError(refusal.unreadable);
  }
  if (pdf.isEncrypted) throw new PdfPageError(refusal.protected);
  return pdf;
}

const save = (pdf: PDFDocument): Promise<Uint8Array> => pdf.save();

function checkedIndices(pdf: PDFDocument, indices: readonly number[]): number[] {
  const count = pdf.getPageCount();
  const unique = [...new Set(indices)].sort((a, b) => a - b);
  if (unique.length === 0 || unique.some((i) => !Number.isInteger(i) || i < 0 || i >= count)) throw new RangeError('page index out of range');
  return unique;
}

/** Turns pages by a quarter turn clockwise (90) or counterclockwise (-90). */
export async function rotatePages(bytes: Uint8Array, indices: readonly number[], delta: 90 | -90): Promise<Uint8Array> {
  const pdf = await load(bytes);
  for (const i of checkedIndices(pdf, indices)) {
    const page = pdf.getPage(i);
    page.setRotation(degrees((((page.getRotation().angle + delta) % 360) + 360) % 360));
  }
  return save(pdf);
}

export async function deletePages(bytes: Uint8Array, indices: readonly number[]): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const doomed = checkedIndices(pdf, indices);
  if (doomed.length >= pdf.getPageCount()) throw new PdfPageError(PDF_PAGE_MESSAGES.lastPage);
  for (const i of doomed.reverse()) pdf.removePage(i);
  return save(pdf);
}

/**
 * The page order after moving the pages at `indices` (kept in their order) so the first of them lands at `to`, counted
 * in the order without them. For example, moving [0] of three pages to 2 gives [1, 2, 0].
 */
export function orderAfterMove(count: number, indices: readonly number[], to: number): number[] {
  const moving = [...new Set(indices)].sort((a, b) => a - b);
  const rest = Array.from({ length: count }, (_, i) => i).filter((i) => !moving.includes(i));
  const at = Math.max(0, Math.min(to, rest.length));
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/** Puts the pages in `order` (a permutation of all page indices). */
export async function reorderPages(bytes: Uint8Array, order: readonly number[]): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const pages = pdf.getPages();
  if (order.length !== pages.length || new Set(order).size !== pages.length || order.some((i) => !Number.isInteger(i) || i < 0 || i >= pages.length)) {
    throw new RangeError('not a page order');
  }
  for (let i = pages.length - 1; i >= 0; i--) pdf.removePage(i);
  order.forEach((from, i) => pdf.insertPage(i, pages[from]!));
  return save(pdf);
}

/** Inserts an empty page at `at` (0 = before the first), the size of the page before it (or after it, for the first). */
export async function insertBlankPage(bytes: Uint8Array, at: number): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const count = pdf.getPageCount();
  const index = Math.max(0, Math.min(at, count));
  const neighbor = count === 0 ? null : pdf.getPage(Math.max(0, index - 1));
  const size = neighbor ? neighbor.getSize() : null;
  pdf.insertPage(index, size ? [size.width, size.height] : DEFAULT_PAGE_SIZE);
  return save(pdf);
}

/** Inserts every page of `other` at `at`; it returns the new bytes and how many pages came in. */
export async function insertPagesFrom(bytes: Uint8Array, other: Uint8Array, at: number): Promise<{ bytes: Uint8Array; inserted: number }> {
  const pdf = await load(bytes);
  const source = await load(other, { protected: PDF_PAGE_MESSAGES.otherProtected, unreadable: PDF_PAGE_MESSAGES.otherUnreadable });
  const copies = await pdf.copyPages(source, source.getPageIndices());
  const index = Math.max(0, Math.min(at, pdf.getPageCount()));
  copies.forEach((page, k) => pdf.insertPage(index + k, page));
  return { bytes: await save(pdf), inserted: copies.length };
}

/** A new PDF of copies of the pages at `indices`, in document order. */
export async function extractPages(bytes: Uint8Array, indices: readonly number[]): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const chosen = checkedIndices(pdf, indices);
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(pdf, chosen)) out.addPage(page);
  return save(out);
}

/** "pages 1-3, 5" for 0-based indices: runs of neighbors are ranges. */
export function describePages(indices: readonly number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b).map((i) => i + 1);
  const runs: string[] = [];
  for (let k = 0; k < sorted.length; ) {
    let end = k;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end]! + 1) end++;
    runs.push(end === k ? String(sorted[k]) : `${sorted[k]}-${sorted[end]}`);
    k = end + 1;
  }
  return `${sorted.length === 1 ? 'page' : 'pages'} ${runs.join(', ')}`;
}

/** Document titles are at most this long (D-118). */
const MAX_TITLE_CHARS = 200;

/** The title of pages taken out of a document: "Report (pages 1-3)", the original shortened to fit. */
export function extractTitle(title: string, pages: readonly number[]): string {
  const suffix = ` (${describePages(pages)})`;
  return `${[...title].slice(0, MAX_TITLE_CHARS - suffix.length).join('').trimEnd()}${suffix}`;
}
