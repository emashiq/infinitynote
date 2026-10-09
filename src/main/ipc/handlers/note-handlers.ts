import { MAX_PUSH_BYTES } from '../../../shared/contracts/collab';
import { MAX_CONTENT_BYTES, NOTE_TOO_LARGE_MESSAGE } from '../../../shared/contracts/notes';
import type { CollabHub } from '../../services/collab-hub';
import type { FormatService } from '../../services/format-service';
import type { NoteReader } from '../../services/note-reader';
import type { NoteWriter } from '../../services/note-writer';
import type { IpcRouter } from '../router';

/** Headroom for the save request fields around the content itself. */
const SAVE_ENVELOPE_BYTES = 65_536;

export interface NoteHandlerDeps {
  reader: () => NoteReader;
  writer: () => NoteWriter;
  collab: () => CollabHub;
  formats: () => FormatService;
}

export function registerNoteHandlers(router: IpcRouter, deps: NoteHandlerDeps): void {
  router.register('note:open', (req) => deps.reader().open(req.noteId));
  // Whichever limit trips (this payload ceiling or the writer's content limit), the user sees the same message (QA-1).
  router.register('note:save', (req) => deps.writer().save(req), {
    maxPayloadBytes: MAX_CONTENT_BYTES + SAVE_ENVELOPE_BYTES,
    tooLargeMessage: NOTE_TOO_LARGE_MESSAGE,
  });
  router.register('note:convertFormat', (req) => deps.formats().convert(req));
  // Live sync (D-103): a view takes part only from the window it joined from; a sticky only for its own note.
  router.register('collab:join', (req, ctx) => deps.collab().join(req.noteId, req.viewId, ctx.webContentsId));
  router.register('collab:push', (req, ctx) => deps.collab().push(req, ctx.webContentsId), {
    maxPayloadBytes: MAX_PUSH_BYTES,
    tooLargeMessage: NOTE_TOO_LARGE_MESSAGE,
  });
  router.register('collab:pull', (req, ctx) => deps.collab().pull(req, ctx.webContentsId));
  router.register('collab:flush', (req, ctx) => deps.collab().flush(req, ctx.webContentsId));
  router.register('collab:leave', (req, ctx) => deps.collab().leave(req.noteId, req.viewId, ctx.webContentsId));
}
