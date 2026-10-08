import { CHANNEL_SCHEMAS } from '../../../shared/contracts/channels';
import type { TrashPurgeRequestType } from '../../../shared/contracts/hierarchy';
import type { TrashService } from '../../services/trash-service';
import type { IpcRouter } from '../router';
import { need } from './need';

export function registerTrashHandlers(router: IpcRouter, get: () => TrashService | null): void {
  const t = () => need(get);
  router.register({
    channel: 'project:trash',
    ...CHANNEL_SCHEMAS['project:trash'],
    handler: (req: { projectId: string }) => t().trashProject(req.projectId),
  });
  router.register({
    channel: 'folder:trash',
    ...CHANNEL_SCHEMAS['folder:trash'],
    handler: (req: { folderId: string }) => t().trashFolder(req.folderId),
  });
  router.register({
    channel: 'note:trash',
    ...CHANNEL_SCHEMAS['note:trash'],
    handler: (req: { noteId: string }) => t().trashNote(req.noteId),
  });
  router.register({ channel: 'trash:list', ...CHANNEL_SCHEMAS['trash:list'], handler: () => t().list() });
  router.register({
    channel: 'trash:restore',
    ...CHANNEL_SCHEMAS['trash:restore'],
    handler: (req: { batchId: string }) => t().restore(req.batchId),
  });
  router.register({
    channel: 'trash:purge',
    ...CHANNEL_SCHEMAS['trash:purge'],
    handler: (req: TrashPurgeRequestType) => t().purge(req),
  });
}
