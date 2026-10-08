import { CHANNEL_SCHEMAS } from '../../../shared/contracts/channels';
import { MAX_CONTENT_BYTES, type NoteSaveRequestType } from '../../../shared/contracts/notes';
import type { LeaseManager } from '../../services/lease-manager';
import type { NoteReader } from '../../services/note-reader';
import type { NoteWriter } from '../../services/note-writer';
import type { IpcRouter } from '../router';
import { need } from './need';

export interface NoteHandlerDeps {
  reader: () => NoteReader | null;
  writer: () => NoteWriter | null;
  leases: () => LeaseManager | null;
}

export function registerNoteHandlers(router: IpcRouter, deps: NoteHandlerDeps): void {
  router.register({
    channel: 'note:open',
    ...CHANNEL_SCHEMAS['note:open'],
    handler: (req: { noteId: string }) => need(deps.reader).open(req.noteId),
  });
  router.register({
    channel: 'note:save',
    ...CHANNEL_SCHEMAS['note:save'],
    maxPayloadBytes: MAX_CONTENT_BYTES + 65536,
    handler: (req: NoteSaveRequestType, ctx) => need(deps.writer).save(req, { webContentsId: ctx.webContentsId }),
  });
  router.register({
    channel: 'lease:acquire',
    ...CHANNEL_SCHEMAS['lease:acquire'],
    handler: (req: { noteId: string; viewId: string }, ctx) => need(deps.leases).acquire(req.noteId, req.viewId, ctx.webContentsId),
  });
  router.register({
    channel: 'lease:release',
    ...CHANNEL_SCHEMAS['lease:release'],
    handler: (req: { noteId: string; viewId: string; leaseToken: string }, ctx) =>
      need(deps.leases).release(req.noteId, req.viewId, req.leaseToken, ctx.webContentsId),
  });
}
