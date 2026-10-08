import { MAX_CONTENT_BYTES } from '../../../shared/contracts/notes';
import type { LeaseManager } from '../../services/lease-manager';
import type { NoteReader } from '../../services/note-reader';
import type { NoteWriter } from '../../services/note-writer';
import type { IpcRouter } from '../router';

/** Headroom for the save request fields around the content itself. */
const SAVE_ENVELOPE_BYTES = 65_536;

export interface NoteHandlerDeps {
  reader: () => NoteReader;
  writer: () => NoteWriter;
  leases: () => LeaseManager;
}

export function registerNoteHandlers(router: IpcRouter, deps: NoteHandlerDeps): void {
  router.register('note:open', (req) => deps.reader().open(req.noteId));
  router.register('note:save', (req, ctx) => deps.writer().save(req, ctx), { maxPayloadBytes: MAX_CONTENT_BYTES + SAVE_ENVELOPE_BYTES });
  router.register('lease:acquire', (req, ctx) => deps.leases().acquire(req.noteId, req.viewId, ctx.webContentsId));
  router.register('lease:release', (req, ctx) => deps.leases().release(req.noteId, req.viewId, req.leaseToken, ctx.webContentsId));
}
