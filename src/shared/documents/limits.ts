import { DOCUMENT_MAX_MB_RANGE } from '../attachments/limits';

/**
 * A managed document is never larger than the largest copy limit (D-108): the user's copy limit applies when a file is
 * imported, and saves of a stored document may grow it up to this size (D-118).
 */
export const MANAGED_DOCUMENT_MAX_MB = DOCUMENT_MAX_MB_RANGE.max;
/** The largest document a viewer may save back to a linked file. */
export const LINKED_DOCUMENT_SAVE_MAX_MB = 200;
/** Extracted text kept in the search index per document. */
export const MAX_DOCUMENT_TEXT_CHARS = 500_000;
/** PDF text for search is read from the first pages of files up to this size (D-129). */
export const MAX_PDF_TEXT_FILE_MB = 100;
export const MAX_PDF_TEXT_PAGES = 1000;
