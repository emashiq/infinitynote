import type { HomeScopeType, HomeSummaryType } from '../../shared/contracts/home';
import { buildPathIndex } from '../../shared/tree/paths';
import type { Db } from '../db/driver';
import { HierarchyRepo, NOTE_META_COLS, type NoteMetaRow } from '../db/repositories/hierarchy-repo';
import { toNoteSummary } from './dto';

export const PINNED_LIMIT = 100;
export const RECENT_LIMIT = 10;

export class HomeService {
  private readonly repo: HierarchyRepo;

  constructor(private readonly db: Db) {
    this.repo = new HierarchyRepo(db);
  }

  summary(requested: HomeScopeType): HomeSummaryType {
    let scope = requested;
    let scopeValid = true;
    if (scope.kind === 'project') {
      const p = this.repo.getProject(scope.projectId);
      if (!p || p.deleted_at !== null) {
        scope = { kind: 'all' };
        scopeValid = false;
      }
    }
    const filter = scope.kind === 'all' ? '' : scope.kind === 'common' ? ' AND project_id IS NULL' : ' AND project_id = ?';
    const args: string[] = scope.kind === 'project' ? [scope.projectId] : [];
    const index = buildPathIndex(
      this.repo.liveProjects().map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at })),
      this.repo.liveFolders().map((f) => ({ id: f.id, projectId: f.project_id, parentId: f.parent_id, name: f.name, createdAt: f.created_at })),
    );
    const pinned = this.db
      .prepare<string[], NoteMetaRow>(
        `SELECT ${NOTE_META_COLS} FROM notes WHERE deleted_at IS NULL AND pinned_at IS NOT NULL${filter} ORDER BY pinned_at DESC, id LIMIT ${PINNED_LIMIT}`,
      )
      .all(...args);
    const pinnedTotal =
      this.db
        .prepare<string[], { n: number }>(`SELECT count(*) AS n FROM notes WHERE deleted_at IS NULL AND pinned_at IS NOT NULL${filter}`)
        .get(...args)?.n ?? 0;
    const recent = this.db
      .prepare<string[], NoteMetaRow>(
        `SELECT ${NOTE_META_COLS} FROM notes WHERE deleted_at IS NULL${filter} ORDER BY updated_at DESC, id LIMIT ${RECENT_LIMIT}`,
      )
      .all(...args);
    return {
      scope,
      scopeValid,
      pinned: pinned.map((r) => toNoteSummary(r, index)),
      pinnedTotal,
      recent: recent.map((r) => toNoteSummary(r, index)),
    };
  }
}
