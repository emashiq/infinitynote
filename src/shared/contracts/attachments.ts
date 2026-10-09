import { z } from 'zod';
import { MAX_FILES_PER_ACTION } from '../attachments/limits';
import { Uuid } from './ids';

export const AttachmentKind = z.enum(['image', 'document']);
export type AttachmentKindType = z.infer<typeof AttachmentKind>;

export const AttachmentDto = z.strictObject({
  id: Uuid,
  kind: AttachmentKind,
  mime: z.string().max(100),
  sizeBytes: z.number().int().min(0),
  originalName: z.string().max(255).nullable(),
  width: z.number().int().min(1).nullable(),
  height: z.number().int().min(1).nullable(),
});
export type AttachmentDtoType = z.infer<typeof AttachmentDto>;

/** Binary payload sent through the bridge; structured clone keeps it a Uint8Array (D-054). */
const Bytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array && v.byteLength >= 1, 'Expected file bytes');

export const AttachmentImportBytesRequest = z.strictObject({
  kind: AttachmentKind,
  originalName: z.string().max(255).optional(),
  bytes: Bytes,
});
export type AttachmentImportBytesRequestType = z.infer<typeof AttachmentImportBytesRequest>;
export const AttachmentImportBytesResponse = z.strictObject({ attachment: AttachmentDto });

export const MAX_REJECTED_FILES = 100;
export const RejectedFile = z.strictObject({ name: z.string().max(255), code: z.string(), message: z.string() });
export type RejectedFileType = z.infer<typeof RejectedFile>;

/** The native file picker (D-108): main keeps the chosen paths; the renderer sees names and sizes and adds by index. */
export const PickFilesRequest = z.strictObject({ kind: AttachmentKind });
export const PickedFile = z.strictObject({ name: z.string().min(1).max(255), sizeBytes: z.number().int().min(0) });
export const PickFilesResponse = z.strictObject({
  canceled: z.boolean(),
  /** Names this pick in attachment:addPicked; null when nothing was picked. */
  pickId: Uuid.nullable(),
  files: z.array(PickedFile).max(MAX_FILES_PER_ACTION),
  /** More than the 20 files of one action were picked; the rest were left out. */
  truncated: z.boolean(),
  rejected: z.array(RejectedFile).max(MAX_REJECTED_FILES),
});
export type PickFilesResponseType = z.infer<typeof PickFilesResponse>;

export const AddAction = z.enum(['copy', 'link']);
export const AddPickedRequest = z.strictObject({ pickId: Uuid, index: z.number().int().min(0).max(MAX_FILES_PER_ACTION - 1), action: AddAction });

/** Longest stored path of a linked file (Linux PATH_MAX); longer paths cannot be linked. */
export const MAX_LINK_PATH = 4096;
export const LinkedPath = z
  .string()
  .min(1)
  .max(MAX_LINK_PATH)
  .refine((p) => !p.includes('\0'), 'Invalid path');

/** A file linked at its original location (D-108): nothing is copied, and main keeps the path. */
export const FileLinkDto = z.strictObject({ id: Uuid, name: z.string().min(1).max(255), sizeBytes: z.number().int().min(0), path: LinkedPath });
export type FileLinkDtoType = z.infer<typeof FileLinkDto>;

/** One file added to a note: copied into the app or linked. */
export const AddedFile = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('attachment'), attachment: AttachmentDto }),
  z.strictObject({ type: z.literal('link'), link: FileLinkDto }),
]);
export type AddedFileType = z.infer<typeof AddedFile>;

/**
 * Links a dropped or pasted file. Only the preload sends it: it takes the path from the File itself
 * (webUtils.getPathForFile), so page script can never name a path (D-115); main checks it.
 */
export const FileLinkCreateRequest = z.strictObject({ path: LinkedPath });
export const FileLinkCreateResponse = z.strictObject({ link: FileLinkDto });

/** `blocked`: the file exists but is a program, script, shortcut or unknown type, so it is only shown in its folder. */
export const LinkedFileState = z.enum(['available', 'blocked', 'missing']);
export type LinkedFileStateType = z.infer<typeof LinkedFileState>;
export const FileLinkStatusRequest = z.strictObject({ linkId: Uuid });
export const FileLinkStatusResponse = z.strictObject({ path: LinkedPath.nullable(), sizeBytes: z.number().int().min(0).nullable(), state: LinkedFileState });
export type FileLinkStatusType = z.infer<typeof FileLinkStatusResponse>;

/** Open, Show in folder and Copy into Infinity Notes for a linked file; the note must use the link. */
export const FileLinkRequest = z.strictObject({ noteId: Uuid, linkId: Uuid });
export const FileLinkCopyInResponse = z.strictObject({ attachment: AttachmentDto });

/** Opening a stored file in its OS app, or showing it in the file manager (INF-REF-08). The note must link the file. */
export const AttachmentHandoffRequest = z.strictObject({ noteId: Uuid, attachmentId: Uuid });
export const AttachmentOpenResponse = z.strictObject({ opened: z.literal(true) });
export const AttachmentShowResponse = z.strictObject({ shown: z.literal(true) });

export const HANDOFF_MESSAGES = {
  blocked: 'This kind of file is not opened from Infinity Notes. Use Show in folder.',
  missing: 'This file is no longer available',
  failed: 'This file could not be opened on this desktop',
} as const;

/** Zod-free, so the preload can use it. */
export { LINK_MESSAGES } from '../attachments/link-messages';
