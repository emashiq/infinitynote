import { MAX_CONTENT_BYTES, NOTE_TOO_LARGE_MESSAGE } from '../../../shared/contracts/notes';
import type { FormatService } from '../../services/format-service';
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
  formats: () => FormatService;
}

export function registerNoteHandlers(router: IpcRouter, deps: NoteHandlerDeps): void {
  router.register('note:open', (req) => deps.reader().open(req.noteId));
  // Whichever limit trips (this payload ceiling or the writer's content limit), the user sees the same message (QA-1).
  router.register('note:save', (req, ctx) => deps.writer().save(req, ctx), {
    maxPayloadBytes: MAX_CONTENT_BYTES + SAVE_ENVELOPE_BYTES,
    tooLargeMessage: NOTE_TOO_LARGE_MESSAGE,
  });
  router.register('lease:acquire', (req, ctx) => deps.leases().acquire(req.noteId, req.viewId, ctx.webContentsId));
  router.register('lease:release', (req, ctx) => deps.leases().release(req.noteId, req.viewId, req.leaseToken, ctx.webContentsId));
  router.register('lease:take', (req, ctx) => deps.leases().take(req.noteId, req.viewId, ctx.webContentsId));
  router.register('note:convertFormat', (req, ctx) => deps.formats().convert(req, ctx));
}
