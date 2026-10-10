import { MAX_PRESENTATION_SLIDES, MAX_SHAPE_TEXT_CHARS, MAX_SLIDE_IMAGE_BYTES, MAX_SLIDE_NOTES_CHARS, PRESENTATION_LIMITS } from '../../../shared/documents/presentation';
import type { PackageRefusal } from './pptx-package';

const MB = (bytes: number) => Math.round(bytes / (1024 * 1024));

/** What the presentation viewer says (F5). */
export const PPTX_MESSAGES = {
  opening: 'Opening presentation…',
  unreadable: 'This presentation could not be read.',
  refusedTitle: 'This presentation does not open in Infinity Notes',
  refused: {
    tooLarge: `Presentations up to ${MB(PRESENTATION_LIMITS.maxFileBytes)} MB open in Infinity Notes. Open this one in your system app.`,
    notPresentation: 'This file is not a readable PowerPoint presentation. It may be damaged, or unpack to more than Infinity Notes reads.',
    macros: 'This presentation contains macros, which Infinity Notes does not open.',
    tooManySlides: `Presentations with up to ${MAX_PRESENTATION_SLIDES.toLocaleString('en-US')} slides open in Infinity Notes. Open this one in your system app.`,
  } satisfies Record<PackageRefusal, string>,
  notShown: (features: readonly string[]): string => `Shown simplified or not at all: ${features.join(', ')}. They are kept as they are when you save.`,
  editRefused: 'That change could not be made to this presentation.',
  lastSlide: 'A presentation keeps at least one slide.',
  notAnImage: `Insert a PNG or JPEG picture of up to ${MB(MAX_SLIDE_IMAGE_BYTES)} MB.`,
  textTooLong: `A text box holds up to ${MAX_SHAPE_TEXT_CHARS.toLocaleString('en-US')} characters.`,
  notesTooLong: `Speaker notes hold up to ${MAX_SLIDE_NOTES_CHARS.toLocaleString('en-US')} characters per slide.`,
  noSlide: (n: number): string => `This presentation has no slide ${n}.`,
  noMatches: 'No matches',
  newTextBox: 'Text',
  drawFailed: 'Some slides could not be drawn.',
} as const;
