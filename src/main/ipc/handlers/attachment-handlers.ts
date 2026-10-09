import { DOCUMENT_MAX_MB_RANGE, maxBytes } from '../../../shared/attachments/limits';
import type { AttachmentHandoff } from '../../services/attachment-handoff';
import type { AttachmentService } from '../../services/attachment-service';
import { jsonByteLength, type IpcRouter } from '../router';

/** Room for the request fields around the bytes. */
const IMPORT_ENVELOPE_BYTES = 64 * 1024;
/** The largest configurable limit; the service enforces the configured one (D-052). */
export const IMPORT_MAX_PAYLOAD_BYTES = maxBytes(DOCUMENT_MAX_MB_RANGE.max) + IMPORT_ENVELOPE_BYTES;

/** Binary size of an import request: the byte length plus the JSON of the other fields. */
export function measureImport(payload: unknown): number {
  const p = payload as { bytes?: unknown } | null;
  const bytes = p?.bytes instanceof Uint8Array ? p.bytes.byteLength : 0;
  return bytes + jsonByteLength(p && typeof p === 'object' ? { ...p, bytes: null } : p);
}

export function registerAttachmentHandlers(router: IpcRouter, attachments: () => AttachmentService, handoff: () => AttachmentHandoff): void {
  router.register('attachment:importBytes', (req) => attachments().importBytes(req), {
    maxPayloadBytes: IMPORT_MAX_PAYLOAD_BYTES,
    measurePayload: measureImport,
  });
  router.register('attachment:importFromDialog', (req, ctx) => attachments().importFromDialog(req.kind, ctx));
  router.register('attachment:open', (req) => handoff().open(req.noteId, req.attachmentId));
  router.register('attachment:showInFolder', (req) => handoff().showInFolder(req.noteId, req.attachmentId));
}
