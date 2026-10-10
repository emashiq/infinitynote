/**
 * Bounds of the presentation editor (F5, D-153). The viewer reads a whole package into the renderer, so its zip is
 * checked first: fewer entries and a smaller unpacked total than main's import check allows, the same ratio rule.
 */
export const PRESENTATION_LIMITS = {
  maxFileBytes: 200 * 1024 * 1024,
  maxEntries: 10_000,
  maxUnpackedBytes: 512 * 1024 * 1024,
  /** An entry above `ratioFloorBytes` may be at most this many times its compressed size. */
  maxRatio: 200,
  ratioFloorBytes: 1024 * 1024,
} as const;

/** The most slides a presentation may have to open in the editor (and the largest slide a link may name). */
export const MAX_PRESENTATION_SLIDES = 2_000;
/** A picture inserted into a slide is at most this large. */
export const MAX_SLIDE_IMAGE_BYTES = 16 * 1024 * 1024;
/** Speaker notes of one slide are at most this long. */
export const MAX_SLIDE_NOTES_CHARS = 100_000;
/** Text typed into one shape is at most this long. */
export const MAX_SHAPE_TEXT_CHARS = 100_000;
