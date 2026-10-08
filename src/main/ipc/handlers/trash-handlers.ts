import type { TrashService } from '../../services/trash-service';
import type { IpcRouter } from '../router';

export function registerTrashHandlers(router: IpcRouter, trash: () => TrashService): void {
  router.register('project:trash', (req) => trash().trashProject(req.projectId));
  router.register('folder:trash', (req) => trash().trashFolder(req.folderId));
  router.register('note:trash', (req) => trash().trashNote(req.noteId));
  router.register('trash:list', () => trash().list());
  router.register('trash:restore', (req) => trash().restore(req.batchId));
  router.register('trash:purge', (req) => trash().purge(req));
}
