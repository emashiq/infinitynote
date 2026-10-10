import type { DocxImportErrorCode, EditRefusalReason, ExportProblem } from '@portone/docx-editor';
import type { FidelityNote } from '@portone/docx-editor/commands';

/** What the Word viewer says (F4, D-142..D-148). The editor's own English one-liners are for developers; these are the user's. */
export const DOCX_MESSAGES = {
  unreadable: 'This Word document could not be read.',
  unwritable: 'This document could not be written back unchanged, so it was not saved. Undo the last change, then save again.',
  refusedTitle: 'This Word document opens read-only',
  previewNote: 'This is a preview: Infinity Notes cannot edit this file without changing parts of it, so it is not edited here.',
  previewFailed: 'Infinity Notes cannot show a preview of this file either. Open it in your system app.',
  placeholders: 'Some content of this document is shown as a placeholder. It is kept unchanged when you save.',
  headingMissing: (heading: string): string => `This document has no heading “${heading}”.`,
  paragraphMissing: (index: number): string => `This document has no paragraph ${index + 1}.`,
  noMatches: 'No matches',
} as const;

/** Why the editor refused to open a file, by its stable error code (D-144). */
export const DOCX_IMPORT_MESSAGES: Readonly<Record<DocxImportErrorCode, string>> = {
  'no-xml-parser': 'This window cannot read Word documents.',
  'not-a-docx': 'This file is not a readable Word document. It may be damaged.',
  'too-large': 'This Word document is too large to open in Infinity Notes.',
  'missing-part': 'This Word document has no main text part.',
  'missing-body': 'This Word document has no body.',
  'malformed-xml': 'Parts of this Word document cannot be read. It may be damaged.',
  'unsupported-conformance': 'This Word document is saved as “Strict Open XML”, which Infinity Notes cannot edit. Save it as a regular Word document (.docx) to edit it here.',
  'unsupported-content': 'This Word document holds content that Infinity Notes cannot keep unchanged when it saves.',
};

/** Codes whose files are still worth a read-only preview: the package is readable, the editor only cannot write it back. */
const PREVIEWABLE: ReadonlySet<DocxImportErrorCode> = new Set(['malformed-xml', 'unsupported-conformance', 'unsupported-content', 'missing-part', 'missing-body']);

export function canPreview(code: DocxImportErrorCode): boolean {
  return PREVIEWABLE.has(code);
}

/** Why a save was refused before anything was written: what the editor could not write back safely (D-144). */
export function exportProblemMessage(problem: ExportProblem): string {
  switch (problem.code) {
    case 'invalid-table':
      return 'A table in this document has merged cells that no longer fit its rows. Undo the last table change, then save again.';
    case 'missing-content-types':
      return 'This document cannot take new pictures, lists or comments because its package has no content types part.';
    case 'lost-original':
    case 'malformed-xml':
      return DOCX_MESSAGES.unwritable;
    case 'unsupported-content':
      return problem.reason.kind === 'undefined-list'
        ? 'A list in this document has no definition, so it was not saved. Make the list again, then save.'
        : 'This document holds a change Infinity Notes cannot write into the file, so it was not saved. Undo the last change, then save again.';
  }
}

/** The status line after the editor refused an edit (typing into locked content, a preserved part, a protected document). */
export const EDIT_REFUSAL_MESSAGES: Readonly<Record<EditRefusalReason, string>> = {
  protection: 'This document is read-only.',
  lock: 'That part of the document is locked.',
  controlEdge: 'That edit would break a content control.',
  preserved: 'That content is kept as it is and cannot be edited here.',
  section: 'That edit would remove a section break.',
};

/** Whether the editor shows part of the document as a placeholder it keeps unchanged. */
export function hasPlaceholders(notes: readonly FidelityNote[]): boolean {
  return notes.some((note) => note.severity !== 'approximated');
}
