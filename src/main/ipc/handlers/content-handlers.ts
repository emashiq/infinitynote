import type { DraftService } from '../../services/draft-service';
import type { VersionService } from '../../services/version-service';
import type { IpcRouter } from '../router';

export function registerContentHandlers(router: IpcRouter, deps: { versions: () => VersionService; drafts: () => DraftService }): void {
  router.register('versions:list', (req) => deps.versions().list(req.noteId, req.limit));
  router.register('versions:restore', (req, ctx) => deps.versions().restore(req, ctx));
  router.register('drafts:list', (req) => deps.drafts().list(req.noteId));
  router.register('drafts:resolve', (req, ctx) => deps.drafts().resolve(req, ctx));
}
