import type { ReferenceService } from '../../services/reference-service';
import type { SearchService } from '../../services/search-service';
import type { TagService } from '../../services/tag-service';
import type { IpcRouter } from '../router';

/** References and document backlinks, the picker's block list, search and tags (Phase 07, D-098, D-156). */
export function registerRetrievalHandlers(
  router: IpcRouter,
  deps: { references: () => ReferenceService; search: () => SearchService; tags: () => TagService },
): void {
  router.register('refs:list', (req) => deps.references().list(req.noteId));
  router.register('refs:documentBacklinks', (req) => deps.references().documentBacklinks(req.documentId));
  router.register('notes:pick', (req) => deps.references().pickBlocks(req.noteId, req.query));
  router.register('search:query', (req) => deps.search().query(req));
  router.register('tags:list', (req) => deps.tags().list(req.noteId));
  router.register('tags:set', (req) => deps.tags().set(req.noteId, req.tags));
}
