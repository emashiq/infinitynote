import { z } from 'zod';
import { Uuid } from '../contracts/ids';
import type { DocumentKind } from '../documents/kinds';
import { MAX_PRESENTATION_SLIDES } from '../documents/presentation';
import { columnLetters } from '../documents/targets';

/**
 * Where a comment thread is anchored (F8, D-165). A note's thread is anchored by the `comment` mark in its text (the
 * mark carries the thread ID); the anchor keeps the block it was made in. Documents are anchored app-side: a PDF page
 * and an optional area of it (fractions of the page, so zoom and rotation do not move it), a spreadsheet cell
 * (zero-based like links, D-137), a slide and an optional shape, a Word paragraph (zero-based among the body's
 * paragraphs, D-146), or the selected text of an HTML page (the thread's quote, and which occurrence of it).
 */
const Fraction = z.number().min(0).max(1);

export const CommentRect = z
  .strictObject({ x: Fraction, y: Fraction, width: Fraction, height: Fraction })
  .refine((r) => r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001, { message: 'The area must lie on the page' });

export const CommentAnchor = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), blockId: Uuid.nullable() }),
  z.strictObject({ type: z.literal('pdf'), page: z.number().int().min(1).max(100_000), rect: CommentRect.nullable() }),
  z.strictObject({
    type: z.literal('cell'),
    sheet: z.string().min(1).max(31),
    row: z.number().int().min(0).max(1_048_575),
    col: z.number().int().min(0).max(16_383),
  }),
  z.strictObject({ type: z.literal('slide'), slide: z.number().int().min(1).max(MAX_PRESENTATION_SLIDES), shapeId: z.string().min(1).max(64).nullable() }),
  z.strictObject({ type: z.literal('paragraph'), paragraph: z.number().int().min(0).max(10_000_000) }),
  z.strictObject({ type: z.literal('quote'), occurrence: z.number().int().min(0).max(100_000) }),
]);
export type CommentAnchorType = z.infer<typeof CommentAnchor>;
export type CommentAnchorKind = CommentAnchorType['type'];

/** The one anchor type each kind of item takes. */
const ANCHOR_OF_DOCUMENT: Readonly<Record<DocumentKind, CommentAnchorKind>> = {
  pdf: 'pdf',
  xlsx: 'cell',
  csv: 'cell',
  pptx: 'slide',
  docx: 'paragraph',
  html: 'quote',
};

export function anchorKindFor(target: { kind: 'note' } | { kind: 'document'; documentKind: DocumentKind }): CommentAnchorKind {
  return target.kind === 'note' ? 'text' : ANCHOR_OF_DOCUMENT[target.documentKind];
}

/** Whether an anchor suits its item: an anchor of another kind (a cell on a note) is refused by main. */
export function anchorFits(anchor: CommentAnchorType, target: { kind: 'note' } | { kind: 'document'; documentKind: DocumentKind }): boolean {
  return anchor.type === anchorKindFor(target);
}

/** A quote is required where text is what the comment is on (a note, an HTML page); elsewhere it only describes the place. */
export const anchorNeedsQuote = (anchor: CommentAnchorType): boolean => anchor.type === 'quote' || anchor.type === 'text';

/** Where a document comment is, as the sidebar names it ("Page 3", "Budget!B2", "Slide 4"); '' for text anchors. */
export function describeAnchor(anchor: CommentAnchorType): string {
  switch (anchor.type) {
    case 'pdf':
      return `Page ${anchor.page}`;
    case 'cell':
      return `${anchor.sheet}!${columnLetters(anchor.col)}${anchor.row + 1}`;
    case 'slide':
      return `Slide ${anchor.slide}`;
    case 'paragraph':
      return `Paragraph ${anchor.paragraph + 1}`;
    case 'text':
    case 'quote':
      return '';
  }
}
