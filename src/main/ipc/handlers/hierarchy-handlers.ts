import { CHANNEL_SCHEMAS } from '../../../shared/contracts/channels';
import type { FolderTargetType, ItemKindType, LocationType } from '../../../shared/contracts/hierarchy';
import type { HierarchyService } from '../../services/hierarchy-service';
import type { IpcRouter } from '../router';
import { need } from './need';

export function registerHierarchyHandlers(router: IpcRouter, get: () => HierarchyService | null): void {
  const h = () => need(get);
  router.register({ channel: 'tree:list', ...CHANNEL_SCHEMAS['tree:list'], handler: () => h().list() });
  router.register({
    channel: 'project:create',
    ...CHANNEL_SCHEMAS['project:create'],
    handler: (req: { name: string }) => h().createProject(req.name),
  });
  router.register({
    channel: 'project:rename',
    ...CHANNEL_SCHEMAS['project:rename'],
    handler: (req: { projectId: string; name: string }) => h().renameProject(req.projectId, req.name),
  });
  router.register({
    channel: 'folder:create',
    ...CHANNEL_SCHEMAS['folder:create'],
    handler: (req: { location: FolderTargetType; name: string }) => h().createFolder(req.location, req.name),
  });
  router.register({
    channel: 'folder:rename',
    ...CHANNEL_SCHEMAS['folder:rename'],
    handler: (req: { folderId: string; name: string }) => h().renameFolder(req.folderId, req.name),
  });
  router.register({
    channel: 'folder:move',
    ...CHANNEL_SCHEMAS['folder:move'],
    handler: (req: { folderId: string; target: FolderTargetType }) => h().moveFolder(req.folderId, req.target),
  });
  router.register({
    channel: 'note:create',
    ...CHANNEL_SCHEMAS['note:create'],
    handler: (req: { location: LocationType; sticky: boolean; title?: string }) => h().createNote(req.location, req.sticky, req.title),
  });
  router.register({
    channel: 'note:rename',
    ...CHANNEL_SCHEMAS['note:rename'],
    handler: (req: { noteId: string; title: string }) => h().renameNote(req.noteId, req.title),
  });
  router.register({
    channel: 'note:move',
    ...CHANNEL_SCHEMAS['note:move'],
    handler: (req: { noteId: string; target: LocationType }) => h().moveNote(req.noteId, req.target),
  });
  router.register({
    channel: 'note:setPinned',
    ...CHANNEL_SCHEMAS['note:setPinned'],
    handler: (req: { noteId: string; pinned: boolean }) => h().setPinned(req.noteId, req.pinned),
  });
  router.register({
    channel: 'item:setFavorite',
    ...CHANNEL_SCHEMAS['item:setFavorite'],
    handler: (req: { kind: ItemKindType; id: string; favorite: boolean }) => h().setFavorite(req.kind, req.id, req.favorite),
  });
}
