import type { NoteSummaryType } from '../../shared/contracts/hierarchy';
import { displayTitle } from '../../shared/names';
import type { Db } from '../db/driver';
import { HierarchyRepo, type NoteMetaRow } from '../db/repositories/hierarchy-repo';
import { livePathIndex, toNoteSummary } from './dto';

export const DEFAULT_PALETTE_LIMIT = 20;

/** Title search for the command palette: prefix matches first, then substring matches, each most recent first. */
export class PaletteService {
  private readonly repo: HierarchyRepo;

  constructor(db: Db) {
    this.repo = new HierarchyRepo(db);
  }

  searchTitles(query: string, limit = DEFAULT_PALETTE_LIMIT): { results: NoteSummaryType[] } {
    const q = query.trim().toLocaleLowerCase();
    if (q === '') return { results: [] };
    const prefix: NoteMetaRow[] = [];
    const contains: NoteMetaRow[] = [];
    for (const n of this.repo.liveNotes()) {
      const title = displayTitle(n.title).toLocaleLowerCase();
      if (title.startsWith(q)) prefix.push(n);
      else if (title.includes(q)) contains.push(n);
    }
    const byRecent = (a: NoteMetaRow, b: NoteMetaRow) =>
      b.updated_at - a.updated_at || (a.id < b.id ? -1 : 1);
    const matched = [...prefix.sort(byRecent), ...contains.sort(byRecent)].slice(0, limit);
    if (matched.length === 0) return { results: [] };
    const index = livePathIndex(this.repo);
    return { results: matched.map((n) => toNoteSummary(n, index)) };
  }
}
