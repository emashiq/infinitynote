import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { DocumentReadWorkbookResponseType } from '../../shared/contracts/documents';
import type { DocumentDtoType } from '../../shared/contracts/hierarchy';
import type { CsvFormatType, WorkbookType } from '../../shared/documents/workbook';
import type { DocumentKind } from '../../shared/documents/kinds';
import type { ViewerCommentAnchors } from '../comments/document-comment-host';
import type { DocumentTargetRequest } from '../state/tabs-store';

/** What a viewer may ask of the document tab around it. */
export interface DocumentViewerHost {
  notify(message: string, tone?: 'info' | 'error'): void;
  /** Copies text to the clipboard; false when the system refused. */
  copyText(text: string): Promise<boolean>;
  /** Saves edited bytes as the next revision; false after the tab showed why it did not. */
  save(bytes: Uint8Array): Promise<boolean>;
  /** How to save edits not saved yet before the tab is left or the window closes; null when there are none. */
  setUnsaved(flush: (() => Promise<boolean>) | null): void;
  /** A PDF the user picks in main's file dialog; null when canceled or refused (the tab said why). */
  pickPdf(): Promise<{ name: string; bytes: Uint8Array } | null>;
  /** Stores bytes as a new document of this kind next to this one; its title, or null after the tab said why not. */
  createBeside(title: string, bytes: Uint8Array): Promise<string | null>;
  /** The workbook of a spreadsheet (or of the version shown), read in main (F3, D-134); a message when it cannot be. */
  readWorkbook(): Promise<{ ok: true; data: DocumentReadWorkbookResponseType } | { ok: false; message: string }>;
  /** Saves an edited workbook as the next revision; false after the tab showed why it did not. */
  saveWorkbook(workbook: WorkbookType, csv: CsvFormatType | null): Promise<boolean>;
  /** Offers comments on the document while the viewer shows it (D-165); the returned function ends that. */
  comments(anchors: ViewerCommentAnchors): () => void;
}

export interface DocumentViewerProps {
  document: DocumentDtoType;
  /** Where the bytes are read from (the document protocol, by ID); it changes with each revision. */
  sourceUrl: string;
  host: DocumentViewerHost;
  /** Where the document was last asked to open (a PDF page, a sheet, a Word heading); a new `seq` is a new request (D-132). */
  target: DocumentTargetRequest | null;
  /** Counts Ctrl+F presses while this tab is active, for a viewer with a find bar. */
  findRequests: number;
  /** An earlier version is shown (Versions panel, D-141): the viewer shows it without editing or saving. */
  readOnly: boolean;
}

export type DocumentViewer = ComponentType<DocumentViewerProps>;

/** Excel and CSV documents share one spreadsheet chunk. */
const SpreadsheetViewer = lazy(() => import('./spreadsheet/SpreadsheetViewer'));

/**
 * One lazily loaded viewer module per kind (D-118): each is its own chunk, fetched the first time a document of its kind
 * opens, so startup does not grow with the viewers. Every kind has one since the PowerPoint viewer (F5).
 */
export const DOCUMENT_VIEWERS: Readonly<Record<DocumentKind, LazyExoticComponent<DocumentViewer>>> = {
  html: lazy(() => import('./html/HtmlViewer')),
  pdf: lazy(() => import('./pdf/PdfViewer')),
  docx: lazy(() => import('./docx/DocxViewer')),
  pptx: lazy(() => import('./pptx/PptxViewer')),
  xlsx: SpreadsheetViewer,
  csv: SpreadsheetViewer,
};
