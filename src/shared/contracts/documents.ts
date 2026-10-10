import { z } from 'zod';
import { MAX_FILES_PER_ACTION } from '../attachments/limits';
import { BLANK_DOCUMENT_KINDS } from '../documents/kinds';
import { CsvFormat, Workbook, WORKBOOK_FEATURES } from '../documents/workbook';
import { NameInput } from '../names';
import { AddAction, LinkedPath, PickFilesResponse } from './attachments';
import { DocumentDto, Location } from './hierarchy';
import { Uuid } from './ids';

/** Documents (v0.3.0, D-118): main window only. Bytes reach viewers through the document protocol, never IPC. */

/** Binary payload through the bridge; structured clone keeps it a Uint8Array (D-054). */
const Bytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array && v.byteLength >= 1, 'Expected file bytes');

/** The original file of a linked document as main last saw it. `modifiedAt` and `sizeBytes` identify that state. */
export const DocumentFileState = z.enum(['available', 'missing', 'damaged']);
export type DocumentFileStateType = z.infer<typeof DocumentFileState>;
export const DocumentFileInfo = z.strictObject({
  path: LinkedPath,
  state: DocumentFileState,
  sizeBytes: z.number().int().min(0).nullable(),
  modifiedAt: z.number().int().nullable(),
});
export type DocumentFileInfoType = z.infer<typeof DocumentFileInfo>;

/** What a save expects the original file of a linked document to still be (the state `document:open` reported). */
export const ExpectedFile = z.strictObject({ sizeBytes: z.number().int().min(0), modifiedAt: z.number().int() });
export type ExpectedFileType = z.infer<typeof ExpectedFile>;

export const DocumentIdRequest = z.strictObject({ documentId: Uuid });
export const DocumentResponse = z.strictObject({ document: DocumentDto });

export const DocumentCreateRequest = z.strictObject({ location: Location, kind: z.enum(BLANK_DOCUMENT_KINDS), title: NameInput.optional() });
export const DocumentPickFilesResponse = PickFilesResponse;
export const DocumentAddPickedRequest = z.strictObject({ pickId: Uuid, index: z.number().int().min(0).max(MAX_FILES_PER_ACTION - 1), action: AddAction, location: Location });
export const DocumentFromAttachmentRequest = z.strictObject({ noteId: Uuid, attachmentId: Uuid });
export const DocumentFromLinkRequest = z.strictObject({ noteId: Uuid, linkId: Uuid });
/** `created` is false when an earlier "Open in Infinity Notes" of the same file made the document. */
export const DocumentFromFileResponse = z.strictObject({ document: DocumentDto, created: z.boolean() });

/** `file` is null for a managed document. */
export const DocumentOpenResponse = z.strictObject({ document: DocumentDto, file: DocumentFileInfo.nullable() });
export type DocumentOpenResponseType = z.infer<typeof DocumentOpenResponse>;

export const DocumentSaveRequest = z.strictObject({
  documentId: Uuid,
  baseRevision: z.number().int().min(0),
  bytes: Bytes,
  /** Linked documents: the state of the original when it was opened; a different file on disk is a conflict. */
  expectedFile: ExpectedFile.optional(),
});
export type DocumentSaveRequestType = z.infer<typeof DocumentSaveRequest>;
export const DocumentSaveResponse = DocumentOpenResponse;

/** CONFLICT details of a refused save. */
export const DocumentConflictReason = z.enum(['revision', 'changedOnDisk', 'inUse']);
export type DocumentConflictReasonType = z.infer<typeof DocumentConflictReason>;

export const DocumentSaveCopyRequest = z.strictObject({ documentId: Uuid, bytes: Bytes });
export const DocumentSaveCopyResponse = z.union([
  z.strictObject({ canceled: z.literal(true) }),
  z.strictObject({ canceled: z.literal(false), document: DocumentDto }),
]);

/** "Insert pages from a PDF" (F2, D-131): the file picked in main's dialog, already checked to be a PDF within the limit. */
export const DocumentPickPdfResponse = z.union([
  z.strictObject({ canceled: z.literal(true) }),
  z.strictObject({ canceled: z.literal(false), name: z.string().min(1).max(255), bytes: Bytes }),
]);

export type DocumentPickPdfResponseType = z.infer<typeof DocumentPickPdfResponse>;

/** A new managed document of the same kind next to `documentId` (F2 "Extract pages", D-131). */
export const DocumentCreateBesideRequest = z.strictObject({ documentId: Uuid, title: NameInput, bytes: Bytes });

export const DocumentRenameRequest = z.strictObject({ documentId: Uuid, title: NameInput });
export const DocumentMoveRequest = z.strictObject({ documentId: Uuid, target: Location });

export const DocumentVersionDto = z.strictObject({
  id: Uuid,
  revision: z.number().int().min(0),
  reason: z.enum(['save', 'restore']),
  sizeBytes: z.number().int().min(0),
  createdAt: z.number().int(),
});
export type DocumentVersionDtoType = z.infer<typeof DocumentVersionDto>;
export const DocumentVersionsResponse = z.strictObject({ versions: z.array(DocumentVersionDto) });
export const DocumentRestoreVersionRequest = z.strictObject({
  documentId: Uuid,
  versionId: Uuid,
  baseRevision: z.number().int().min(0),
  expectedFile: ExpectedFile.optional(),
});
export type DocumentRestoreVersionRequestType = z.infer<typeof DocumentRestoreVersionRequest>;

/** "Save as copy" of a version: a new managed document next to the document with that version's bytes. */
export const DocumentVersionRequest = z.strictObject({ documentId: Uuid, versionId: Uuid });

/** "Export a copy…": the saved bytes, or a version's, written to a file the user picks in main's dialog. */
export const DocumentExportRequest = z.strictObject({ documentId: Uuid, versionId: Uuid.optional() });
export const DocumentExportResponse = z.strictObject({ canceled: z.boolean() });

/** The workbook of a spreadsheet document (F3, D-134), or of one of its versions (read-only in the viewer). */
export const DocumentReadWorkbookRequest = z.strictObject({ documentId: Uuid, versionId: Uuid.optional() });
export const DocumentReadWorkbookResponse = z.strictObject({
  workbook: Workbook,
  /** What the file has that saving would not keep (D-136); empty once the app has saved it. */
  simplified: z.array(z.enum(WORKBOOK_FEATURES)),
  /** How a CSV document is written back; null for xlsx. */
  csv: CsvFormat.nullable(),
});
export type DocumentReadWorkbookResponseType = z.infer<typeof DocumentReadWorkbookResponse>;

/** An edited workbook saved as the document's next revision through `document:save`'s checks (D-119). */
export const DocumentSaveWorkbookRequest = z.strictObject({
  documentId: Uuid,
  baseRevision: z.number().int().min(0),
  workbook: Workbook,
  /** Required for a CSV document: the format it was read with. */
  csv: CsvFormat.optional(),
  expectedFile: ExpectedFile.optional(),
});
export type DocumentSaveWorkbookRequestType = z.infer<typeof DocumentSaveWorkbookRequest>;
