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

export const AttachmentImportDialogRequest = z.strictObject({ kind: AttachmentKind });
export const MAX_REJECTED_FILES = 100;
export const RejectedFile = z.strictObject({ name: z.string().max(255), code: z.string(), message: z.string() });
export type RejectedFileType = z.infer<typeof RejectedFile>;
export const AttachmentImportDialogResponse = z.strictObject({
  canceled: z.boolean(),
  imported: z.array(AttachmentDto).max(MAX_FILES_PER_ACTION),
  rejected: z.array(RejectedFile).max(MAX_REJECTED_FILES),
});
export type AttachmentImportDialogResponseType = z.infer<typeof AttachmentImportDialogResponse>;
