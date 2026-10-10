import type { DocxImportErrorCode } from '@portone/docx-editor';
import { checkZipBounds, type ZipBounds } from '../zip-bounds';

const MIB = 1024 * 1024;

/**
 * What the Word viewer reads into the renderer (F4, D-178): the editor's own package limit (64 MiB in all, its
 * `openParts`) for the file and the unpacked total, and main's entry count and ratio rule (OOXML_LIMITS).
 */
export const WORD_LIMITS: ZipBounds = { maxFileBytes: 64 * MIB, maxEntries: 10_000, maxUnpackedBytes: 64 * MIB, maxRatio: 200, ratioFloorBytes: MIB };

/**
 * Why the bytes do not go to the editor at all, checked from the zip's directory before anything is unpacked (as the
 * presentation viewer does, D-153); null when they may.
 */
export function wordPackageRefusal(bytes: Uint8Array): Extract<DocxImportErrorCode, 'too-large' | 'not-a-docx'> | null {
  switch (checkZipBounds(bytes, WORD_LIMITS)) {
    case 'ok':
      return null;
    case 'tooLarge':
      return 'too-large';
    case 'unreadable':
      return 'not-a-docx';
  }
}
