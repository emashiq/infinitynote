import type { HierarchyService } from '../../services/hierarchy-service';
import type { IpcRouter } from '../router';

export function registerHierarchyHandlers(router: IpcRouter, hierarchy: () => HierarchyService): void {
  router.register('tree:list', () => hierarchy().list());
  router.register('project:create', (req) => hierarchy().createProject(req.name));
  router.register('project:rename', (req) => hierarchy().renameProject(req.projectId, req.name));
  router.register('folder:create', (req) => hierarchy().createFolder(req.location, req.name));
  router.register('folder:rename', (req) => hierarchy().renameFolder(req.folderId, req.name));
  router.register('folder:move', (req) => hierarchy().moveFolder(req.folderId, req.target));
  router.register('note:create', (req) => hierarchy().createNote(req.location, req.sticky, req.title));
  router.register('note:rename', (req) => hierarchy().renameNote(req.noteId, req.title));
  router.register('note:move', (req) => hierarchy().moveNote(req.noteId, req.target));
  router.register('note:setPinned', (req) => hierarchy().setPinned(req.noteId, req.pinned));
  router.register('item:setFavorite', (req) => hierarchy().setFavorite(req.kind, req.id, req.favorite));
}
