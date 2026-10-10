import type { NoteSummaryType } from '../../shared/contracts/hierarchy';
import { MAX_LINK_RESULTS, type LinkCandidateType, type LinksSearchResponseType } from '../../shared/contracts/references';
import { displayTitle } from '../../shared/names';
import { rankByTitle } from '../../shared/search/fuzzy';
import { pathOf } from '../../shared/tree/paths';
import type { Db } from '../db/driver';
import { DocumentsRepo, type DocumentRow } from '../db/repositories/documents-repo';
import { HierarchyRepo, type NoteMetaRow } from '../db/repositories/hierarchy-repo';
import { livePathIndex, toNoteSummary } from './dto';

export const DEFAULT_PALETTE_LIMIT = 20;

type LinkRow = { kind: 'note'; row: NoteMetaRow } | { kind: 'document'; row: DocumentRow };

/** Title search for the command palette and the link picker. */
export class PaletteService {
  private readonly repo: HierarchyRepo;
  private readonly documents: DocumentsRepo;

  constructor(db: Db) {
    this.repo = new HierarchyRepo(db);
    this.documents = new DocumentsRepo(db);
  }

  /** Notes only: prefix matches first, then substring matches, each most recent first. */
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

  /**
   * Live notes and documents for the link picker (D-157), ranked fuzzily by title; an empty query lists the most
   * recently updated items.
   */
  searchLinkTargets(query: string, limit = MAX_LINK_RESULTS): LinksSearchResponseType {
    const rows: LinkRow[] = [
      ...this.repo.liveNotes().map((row): LinkRow => ({ kind: 'note', row })),
      ...this.documents.live().map((row): LinkRow => ({ kind: 'document', row })),
    ];
    const ranked = rankByTitle(query, rows, (r) => displayTitle(r.row.title), (r) => r.row.updated_at).slice(0, limit);
    if (ranked.length === 0) return { items: [] };
    const index = livePathIndex(this.repo);
    const items = ranked.map((r): LinkCandidateType => {
      const base = { id: r.row.id, title: r.row.title, path: pathOf(index, { projectId: r.row.project_id, folderId: r.row.folder_id }) };
      return r.kind === 'note' ? { kind: 'note', ...base, locked: r.row.locked === 1 } : { kind: 'document', ...base, documentKind: r.row.kind };
    });
    return { items };
  }
}
