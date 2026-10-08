import type { HomeScopeType, HomeSummaryType } from '../../shared/contracts/home';
import type { Db } from '../db/driver';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { livePathIndex, toNoteSummary } from './dto';

export const PINNED_LIMIT = 100;
export const RECENT_LIMIT = 10;

/** Pinned and recent notes for Home; a project scope that no longer exists falls back to All. */
export class HomeService {
  private readonly repo: HierarchyRepo;

  constructor(db: Db) {
    this.repo = new HierarchyRepo(db);
  }

  summary(requested: HomeScopeType): HomeSummaryType {
    const project = requested.kind === 'project' ? this.repo.getProject(requested.projectId) : undefined;
    const scopeValid = requested.kind !== 'project' || (project !== undefined && project.deleted_at === null);
    const scope: HomeScopeType = scopeValid ? requested : { kind: 'all' };
    const index = livePathIndex(this.repo);
    return {
      scope,
      scopeValid,
      pinned: this.repo.pinnedNotes(scope, PINNED_LIMIT).map((r) => toNoteSummary(r, index)),
      pinnedTotal: this.repo.countPinned(scope),
      recent: this.repo.recentNotes(scope, RECENT_LIMIT).map((r) => toNoteSummary(r, index)),
    };
  }
}
