import { maxBytes } from '../../../shared/attachments/limits';
import { LINKED_DOCUMENT_SAVE_MAX_MB } from '../../../shared/documents/limits';
import { DOCUMENT_MESSAGES } from '../../../shared/documents/messages';
import { WORKBOOK_MESSAGES } from '../../../shared/documents/workbook-messages';
import type { DocumentService } from '../../documents/document-service';
import type { SpreadsheetService } from '../../documents/spreadsheet/spreadsheet-service';
import type { HierarchyService } from '../../services/hierarchy-service';
import type { TrashService } from '../../services/trash-service';
import type { IpcRouter } from '../router';
import { measureImport } from './attachment-handlers';

/** Room for the request fields around the bytes. */
const SAVE_ENVELOPE_BYTES = 64 * 1024;
/** The largest save any document may make; the service applies the managed limit too (D-118). */
export const DOCUMENT_SAVE_MAX_PAYLOAD_BYTES = maxBytes(LINKED_DOCUMENT_SAVE_MAX_MB) + SAVE_ENVELOPE_BYTES;
/** The JSON of the largest workbook the model allows (D-134) stays well inside this. */
export const WORKBOOK_SAVE_MAX_PAYLOAD_BYTES = 128 * 1024 * 1024;

export interface DocumentHandlerServices {
  documents: () => DocumentService;
  spreadsheets: () => SpreadsheetService;
  hierarchy: () => HierarchyService;
  trash: () => TrashService;
}

/** Documents (D-118): every channel is main-window only (not in the sticky or widget allowlists). */
export function registerDocumentHandlers(router: IpcRouter, use: DocumentHandlerServices): void {
  const binary = { maxPayloadBytes: DOCUMENT_SAVE_MAX_PAYLOAD_BYTES, measurePayload: measureImport, tooLargeMessage: DOCUMENT_MESSAGES.tooLargeToSave(LINKED_DOCUMENT_SAVE_MAX_MB) };
  router.register('document:create', (req) => use.documents().createBlank(req.kind, req.location, req.title));
  router.register('document:pickFiles', (_req, ctx) => use.documents().pickFiles(ctx));
  router.register('document:addPicked', (req, ctx) => use.documents().addPicked(req, ctx));
  router.register('document:fromAttachment', (req) => use.documents().fromAttachment(req.noteId, req.attachmentId));
  router.register('document:fromLink', (req) => use.documents().fromLink(req.noteId, req.linkId));
  router.register('document:open', (req) => use.documents().open(req.documentId));
  router.register('document:save', (req) => use.documents().save(req), binary);
  router.register('document:saveCopy', (req, ctx) => use.documents().saveCopy(req, ctx), binary);
  router.register('document:rename', (req) => use.hierarchy().renameDocument(req.documentId, req.title));
  router.register('document:move', (req) => use.hierarchy().moveDocument(req.documentId, req.target));
  router.register('document:trash', (req) => use.trash().trashDocument(req.documentId));
  router.register('document:versions', (req) => use.documents().versionsOf(req.documentId));
  router.register('document:restoreVersion', (req) => use.documents().restoreVersion(req));
  router.register('document:openExternal', (req) => use.documents().openExternal(req.documentId));
  router.register('document:showInFolder', (req) => use.documents().showInFolder(req.documentId));
  router.register('document:pickPdf', (_req, ctx) => use.documents().pickPdf(ctx));
  router.register('document:createBeside', (req) => use.documents().createBeside(req.documentId, req.title, req.bytes), binary);
  router.register('document:copyVersion', (req) => use.documents().copyVersion(req.documentId, req.versionId));
  router.register('document:export', (req, ctx) => use.documents().exportCopy(req, ctx));
  router.register('document:readWorkbook', (req) => use.spreadsheets().read(req.documentId, req.versionId));
  router.register('document:saveWorkbook', (req) => use.spreadsheets().save(req), { maxPayloadBytes: WORKBOOK_SAVE_MAX_PAYLOAD_BYTES, tooLargeMessage: WORKBOOK_MESSAGES.tooManyCells });
}
