import { DOCUMENT_MAX_MB_RANGE, IMAGE_MAX_MB_RANGE, maxBytes } from '../../../shared/attachments/limits';
import type { AttachmentHandoff } from '../../services/attachment-handoff';
import type { AttachmentService } from '../../services/attachment-service';
import type { FilePicker } from '../../services/file-picker';
import type { LinkedFileService } from '../../services/linked-file-service';
import { jsonByteLength, type IpcRouter } from '../router';

/** Room for the request fields around the bytes. */
const IMPORT_ENVELOPE_BYTES = 64 * 1024;
/** The largest configurable image or copy limit; the service enforces the configured one (D-052, D-108). */
export const IMPORT_MAX_PAYLOAD_BYTES = maxBytes(Math.max(IMAGE_MAX_MB_RANGE.max, DOCUMENT_MAX_MB_RANGE.max)) + IMPORT_ENVELOPE_BYTES;

/** Binary size of an import request: the byte length plus the JSON of the other fields. */
export function measureImport(payload: unknown): number {
  const p = payload as { bytes?: unknown } | null;
  const bytes = p?.bytes instanceof Uint8Array ? p.bytes.byteLength : 0;
  return bytes + jsonByteLength(p && typeof p === 'object' ? { ...p, bytes: null } : p);
}

export interface AttachmentHandlerServices {
  attachments: () => AttachmentService;
  handoff: () => AttachmentHandoff;
  picker: () => FilePicker;
  links: () => LinkedFileService;
}

export function registerAttachmentHandlers(router: IpcRouter, use: AttachmentHandlerServices): void {
  router.register('attachment:importBytes', (req) => use.attachments().importBytes(req), {
    maxPayloadBytes: IMPORT_MAX_PAYLOAD_BYTES,
    measurePayload: measureImport,
  });
  router.register('attachment:pickFiles', (req, ctx) => use.picker().pick(req.kind, ctx));
  router.register('attachment:addPicked', (req, ctx) => use.picker().add(req, ctx));
  router.register('attachment:open', (req) => use.handoff().open(req.noteId, req.attachmentId));
  router.register('attachment:showInFolder', (req) => use.handoff().showInFolder(req.noteId, req.attachmentId));
  router.register('fileLink:create', async (req) => ({ link: await use.links().create(req.path) }));
  router.register('fileLink:status', (req) => use.links().status(req.linkId));
  router.register('fileLink:open', (req) => use.links().open(req.noteId, req.linkId));
  router.register('fileLink:showInFolder', (req) => use.links().showInFolder(req.noteId, req.linkId));
  router.register('fileLink:copyIn', (req) => use.links().copyIn(req.noteId, req.linkId));
}
