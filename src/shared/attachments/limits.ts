/**
 * Attachment limits and the exact user-facing messages (D-054, D-108). Main and renderer use the same builders so a
 * limit reached in either place reads the same.
 */
export const DEFAULT_IMAGE_MAX_MB = 20;
/** Files up to this size are copied into Infinity Notes; larger ones can only be linked to their original (D-108). */
export const DEFAULT_DOCUMENT_MAX_MB = 25;
export const IMAGE_MAX_MB_RANGE = { min: 1, max: 100 } as const;
export const DOCUMENT_MAX_MB_RANGE = { min: 1, max: 25 } as const;

export const MAX_MEGAPIXELS = 100;
export const MAX_PIXELS = MAX_MEGAPIXELS * 1_000_000;
export const MAX_FILES_PER_ACTION = 20;
export const IMPORT_CONCURRENCY = 2;
export const IMPORT_WAIT_ON_FLUSH_MS = 10_000;

export const BYTES_PER_MB = 1024 * 1024;

export type AttachmentKindName = 'image' | 'document';

export function maxBytes(megabytes: number): number {
  return megabytes * BYTES_PER_MB;
}

export const imageTooLarge = (mb: number): string => `This image is larger than ${mb} MB. Change the limit in Settings or use a smaller image.`;
export const fileTooLarge = (mb: number): string => `This file is larger than ${mb} MB, so it is not copied into Infinity Notes. Link to the original instead.`;
export const tooLargeMessage = (kind: AttachmentKindName, mb: number): string => (kind === 'image' ? imageTooLarge(mb) : fileTooLarge(mb));
/** Shown next to a file in the "Add files" dialog when it is over the copy limit. */
export const onlyLinkWarning = (mb: number): string => `Larger than ${mb} MB: can only be linked`;
/** Shown when "Always copy" meets a file over the copy limit: it is linked instead, never dropped. */
export const linkedInsteadMessage = (name: string, mb: number): string => `${name} is larger than ${mb} MB, so it was linked to the original instead of copied.`;

export const ATTACHMENT_MESSAGES = {
  unsupportedImage: 'This image type is not supported. Use PNG, JPEG, GIF or WebP.',
  tooManyPixels: `This image is too large to display. Use an image under ${MAX_MEGAPIXELS} megapixels.`,
  tooManyFiles: `Only the first ${MAX_FILES_PER_ACTION} files were added.`,
  plainNoImages: 'Plain-text notes cannot contain images. Convert to rich text to add images.',
  // D-059: a dropped or pasted document in a plain-text note (the plan names only the image case).
  plainNoFiles: 'Plain-text notes cannot contain files. Convert to rich text to add files.',
  imageFailed: 'The image could not be added.',
  fileFailed: 'The file could not be added.',
  addingImage: 'Adding image…',
  addingFile: 'Adding file…',
  imageUnavailable: 'Image unavailable',
  onlyCopy: 'Can only be copied: Infinity Notes cannot see where this file is stored',
} as const;

export const importFailedMessage = (kind: AttachmentKindName): string =>
  kind === 'image' ? ATTACHMENT_MESSAGES.imageFailed : ATTACHMENT_MESSAGES.fileFailed;
