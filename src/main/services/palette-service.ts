import type { NoteSummaryType } from '../../shared/contracts/hierarchy';
import { displayTitle } from '../../shared/names';
import { buildPathIndex } from '../../shared/tree/paths';
import type { Db } from '../db/driver';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { toNoteSummary } from './dto';

export const DEFAULT_PALETTE_LIMIT = 20;

export class PaletteService {
  private readonly repo: HierarchyRepo;

  constructor(db: Db) {
    this.repo = new HierarchyRepo(db);
  }

  searchTitles(query: string, limit = DEFAULT_PALETTE_LIMIT): { results: NoteSummaryType[] } {
    const q = query.trim().toLocaleLowerCase();
    if (q === '') return { results: [] };
    const prefix: ReturnType<HierarchyRepo['liveNotes']> = [];
    const contains: typeof prefix = [];
    for (const n of this.repo.liveNotes()) {
      const title = displayTitle(n.title).toLocaleLowerCase();
      if (title.startsWith(q)) prefix.push(n);
      else if (title.includes(q)) contains.push(n);
    }
    const byRecent = (a: { updated_at: number; id: string }, b: { updated_at: number; id: string }) =>
      b.updated_at - a.updated_at || (a.id < b.id ? -1 : 1);
    const matched = [...prefix.sort(byRecent), ...contains.sort(byRecent)].slice(0, limit);
    if (matched.length === 0) return { results: [] };
    const index = buildPathIndex(
      this.repo.liveProjects().map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at })),
      this.repo.liveFolders().map((f) => ({ id: f.id, projectId: f.project_id, parentId: f.parent_id, name: f.name, createdAt: f.created_at })),
    );
    return { results: matched.map((n) => toNoteSummary(n, index)) };
  }
}
