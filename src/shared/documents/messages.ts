import { DOCUMENT_KIND_INFO, type DocumentKind } from './kinds';

/** What the app says about documents (D-118). Main and renderer use the same text. */
export const DOCUMENT_MESSAGES = {
  unsupported: 'Infinity Notes opens PDF, Word, PowerPoint, Excel, CSV and HTML files as documents. Add other files to a note instead.',
  damaged: (kind: DocumentKind): string => `This file is not a readable ${DOCUMENT_KIND_INFO[kind].label.toLowerCase()}.`,
  tooLargeToStore: (mb: number): string => `This document is larger than ${mb} MB, so it cannot be stored in Infinity Notes. Save a copy as a file instead.`,
  tooLargeToSave: (mb: number): string => `This document is larger than ${mb} MB and cannot be saved.`,
  tooLargeToInsert: (mb: number): string => `That PDF is larger than ${mb} MB, so its pages cannot be inserted here.`,
  missing: 'That document no longer exists.',
  inTrash: 'This document is in Trash.',
  changedOnDisk: 'This file was changed outside Infinity Notes since it was opened. Reload it, or save your version as a copy.',
  inUse: 'The file could not be replaced. It may be open in another app. Close it there, or save your version as a copy.',
  revisionChanged: 'This document was saved elsewhere since it was opened. Reload it to see the latest version.',
  saveFailed: 'The document could not be saved.',
  importFailed: 'The document could not be added.',
  copyFailed: 'The copy could not be written.',
  exportOverOriginal: 'Choose another file: a copy cannot replace the original.',
  noViewer: (kind: DocumentKind): string => `Infinity Notes has no viewer for ${DOCUMENT_KIND_INFO[kind].label} documents. Open it in your system app.`,
  versionMissing: 'That version no longer exists.',
  notOpenable: 'This kind of document is not opened outside Infinity Notes.',
} as const;

/** What the Versions panel of a document says (D-141). */
export const DOCUMENT_VERSION_MESSAGES = {
  viewing: (revision: number, when: string): string => `Revision ${revision} from ${when}, read-only.`,
  restored: (revision: number): string => `Restored revision ${revision}.`,
  copied: (revision: number, title: string): string => `Saved revision ${revision} as “${title}”.`,
  exported: 'Exported a copy.',
} as const;
