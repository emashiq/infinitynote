import { z } from 'zod';
import type { DocumentKind } from './kinds';
import { MAX_PRESENTATION_SLIDES } from './presentation';

/**
 * A place inside a document to open it at (D-132): a page of a PDF, a sheet and cell of a spreadsheet (zero-based,
 * D-137), a heading or paragraph of a Word document (its text, or the zero-based index among the body's paragraphs,
 * D-146), or a slide of a presentation (one-based, D-152). Links between items (F9) carry it; a viewer that cannot
 * show the place opens the document at its start.
 */
export const DocumentTarget = z.union([
  z.strictObject({ page: z.number().int().min(1).max(100_000) }),
  z.strictObject({
    sheet: z.string().min(1).max(31),
    row: z.number().int().min(0).max(1_048_575).optional(),
    col: z.number().int().min(0).max(16_383).optional(),
  }),
  z.strictObject({ heading: z.string().min(1).max(500) }),
  z.strictObject({ paragraph: z.number().int().min(0).max(10_000_000) }),
  z.strictObject({ slide: z.number().int().min(1).max(MAX_PRESENTATION_SLIDES) }),
]);
export type DocumentTargetType = z.infer<typeof DocumentTarget>;

/** Spreadsheet column letters of a zero-based column index (0 → A, 26 → AA). */
export function columnLetters(col: number): string {
  let n = col + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function columnIndex(letters: string): number {
  return [...letters.toUpperCase()].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
}

/** A short description of a place in a document, as a link shows it ("Page 3", "Budget!B2", "Slide 4"). */
export function describeTarget(target: DocumentTargetType): string {
  if ('page' in target) return `Page ${target.page}`;
  if ('slide' in target) return `Slide ${target.slide}`;
  if ('heading' in target) return target.heading;
  if ('paragraph' in target) return `Paragraph ${target.paragraph + 1}`;
  return target.row !== undefined && target.col !== undefined ? `${target.sheet}!${columnLetters(target.col)}${target.row + 1}` : target.sheet;
}

/** What the link picker asks for to link a place inside a document of each kind; null where no place can be named. */
export const TARGET_PROMPTS: Readonly<Record<DocumentKind, string | null>> = {
  pdf: 'Page number',
  pptx: 'Slide number',
  xlsx: 'Sheet name, or sheet and cell (Budget!B2)',
  docx: 'Heading text',
  csv: null,
  html: null,
};

const CELL = /^(?:'([^']+)'|([^!]+))!([A-Za-z]{1,3})([1-9]\d{0,6})$/;

/** The place typed into the link picker for a document of `kind` (D-156), or null when it names none. */
export function targetFromInput(kind: DocumentKind, input: string): DocumentTargetType | null {
  const text = input.trim();
  if (text === '' || TARGET_PROMPTS[kind] === null) return null;
  const candidate = (() => {
    if (kind === 'pdf') return /^\d+$/.test(text) ? { page: Number(text) } : null;
    if (kind === 'pptx') return /^\d+$/.test(text) ? { slide: Number(text) } : null;
    if (kind === 'docx') return { heading: text };
    const cell = CELL.exec(text);
    if (!cell) return { sheet: text };
    return { sheet: (cell[1] ?? cell[2]!).trim(), col: columnIndex(cell[3]!), row: Number(cell[4]) - 1 };
  })();
  const parsed = DocumentTarget.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
