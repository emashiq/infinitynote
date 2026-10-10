import { extensionFor } from '../attachments/names';
import { normalizeTitle } from '../names';

/**
 * The kinds of file Infinity Notes keeps as documents next to notes (v0.3.0, D-118). Any other file stays a file
 * attachment of a note.
 */
export const DOCUMENT_KINDS = ['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'html'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Kinds that can be created empty ("New Word document", "New spreadsheet", "New presentation"). */
export const BLANK_DOCUMENT_KINDS = ['docx', 'xlsx', 'pptx'] as const;
export type BlankDocumentKind = (typeof BLANK_DOCUMENT_KINDS)[number];

/** The kinds stored as an Office Open XML package (a zip). */
export const OOXML_KINDS: ReadonlySet<DocumentKind> = new Set(['docx', 'pptx', 'xlsx']);

export interface DocumentKindInfo {
  /** What people call it ("Word document"). */
  label: string;
  /** The extension of a stored copy and of a saved copy. */
  extension: string;
  /** The Content-Type the document protocol serves it with. */
  mime: string;
  /** The title of a new blank document of this kind. */
  blankTitle: string;
}

export const DOCUMENT_KIND_INFO: Record<DocumentKind, DocumentKindInfo> = {
  pdf: { label: 'PDF', extension: 'pdf', mime: 'application/pdf', blankTitle: 'Untitled PDF' },
  docx: {
    label: 'Word document',
    extension: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    blankTitle: 'Untitled document',
  },
  pptx: {
    label: 'Presentation',
    extension: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    blankTitle: 'Untitled presentation',
  },
  xlsx: {
    label: 'Spreadsheet',
    extension: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    blankTitle: 'Untitled spreadsheet',
  },
  csv: { label: 'CSV table', extension: 'csv', mime: 'text/csv', blankTitle: 'Untitled table' },
  html: { label: 'Web page', extension: 'html', mime: 'text/html', blankTitle: 'Untitled page' },
};

const KIND_BY_EXTENSION: Readonly<Record<string, DocumentKind>> = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
  xlsx: 'xlsx',
  csv: 'csv',
  html: 'html',
  htm: 'html',
};

/** Every extension a document can be imported from (the file picker's filter). */
export const DOCUMENT_EXTENSIONS: readonly string[] = Object.keys(KIND_BY_EXTENSION);

/** The document kind of a file name by its extension, or null when Infinity Notes does not open that kind. */
export function documentKindOf(name: string | null | undefined): DocumentKind | null {
  return KIND_BY_EXTENSION[extensionFor(name)] ?? null;
}

const MAX_TITLE_CHARS = 200;

/** The title of an imported document: the file name without its extension, at most 200 characters. */
export function titleFromFileName(name: string, kind: DocumentKind): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,10}$/, '');
  // eslint-disable-next-line no-control-regex
  const clean = normalizeTitle(base.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' '));
  const title = [...clean].slice(0, MAX_TITLE_CHARS).join('').trim();
  return title === '' ? DOCUMENT_KIND_INFO[kind].blankTitle : title;
}
