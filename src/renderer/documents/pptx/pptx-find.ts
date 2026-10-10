import type { PptxSourceModel } from '@pptx-glimpse/document';
import { nodeText } from './pptx-model';

/** A match of the find bar (F5, D-152): on a slide, in a drawing's text or in the speaker notes. */
export interface SlideMatch {
  slide: number;
  /** The drawing holding the text, or null for the notes. */
  shapeId: string | null;
  /** Where the match starts in that text, and its length. */
  start: number;
  length: number;
}

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

/** Find stops counting here, like the other document find bars. */
const MAX_SLIDE_MATCHES = 10_000;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The matches of a query in every slide's drawings, in drawing order, then its notes, slide by slide. */
export function findInSlides(model: PptxSourceModel, notes: readonly string[], query: string, options: FindOptions): SlideMatch[] {
  if (query === '') return [];
  const body = escape(query);
  const pattern = new RegExp(options.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, options.caseSensitive ? 'gu' : 'giu');
  const out: SlideMatch[] = [];
  const scan = (slide: number, shapeId: string | null, text: string) => {
    for (const m of text.matchAll(pattern)) {
      if (out.length >= MAX_SLIDE_MATCHES) return;
      out.push({ slide, shapeId, start: m.index, length: m[0].length });
    }
  };
  model.slides.forEach((slide, index) => {
    for (const node of slide.shapes) if (node.nodeId !== undefined) scan(index, String(node.nodeId), nodeText(node));
    scan(index, null, notes[index] ?? '');
  });
  return out;
}
