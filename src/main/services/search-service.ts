import { MAX_SEARCH_RESULTS, SHORT_QUERY_CHARS, type SearchQueryRequestType, type SearchQueryResponseType } from '../../shared/contracts/search';
import { displayTitle } from '../../shared/names';
import { markSubstring, parseMarked } from '../../shared/search/segments';
import type { Db } from '../db/driver';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { SearchRepo, type SearchFilters, type SearchRow } from '../db/repositories/search-repo';
import { livePathIndex, toNoteSummary } from './dto';

/** Characters that make a word searchable for the index tokenizer (letters, digits, marks, private use; D-029). */
const WORD_CHAR = /[\p{L}\p{N}\p{M}\p{Co}]/u;

/**
 * The FTS5 query for user text: every word must match as a prefix ("plan rev" finds "Planning review"). Each word
 * is quoted, so FTS5 operators and punctuation in the text are never interpreted. Null when no word remains.
 */
export function toFtsQuery(text: string): string | null {
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/"/g, ''))
    .filter((w) => WORD_CHAR.test(w));
  return words.length === 0 ? null : words.map((w) => `"${w}"*`).join(' ');
}

/** Note search for the palette (INF-SRCH-01..05): bounded, filtered by scope and tags, with safe highlight segments. */
export class SearchService {
  private readonly repo: SearchRepo;
  private readonly hierarchy: HierarchyRepo;

  constructor(db: Db) {
    this.repo = new SearchRepo(db);
    this.hierarchy = new HierarchyRepo(db);
  }

  query(req: SearchQueryRequestType): SearchQueryResponseType {
    const text = req.query.trim();
    const limit = req.limit ?? MAX_SEARCH_RESULTS;
    const filters: SearchFilters = { scope: req.scope ?? { kind: 'all' }, tags: [...new Set(req.tags ?? [])] };
    let rows: SearchRow[];
    if (text === '') {
      rows = filters.tags.length > 0 ? this.repo.recent(filters, limit) : [];
    } else if ([...text].length <= SHORT_QUERY_CHARS) {
      rows = this.repo.titleContains(text, filters, limit);
    } else {
      const match = toFtsQuery(text);
      rows = match ? this.repo.fullText(match, filters, limit) : [];
    }
    if (rows.length === 0) return { results: [] };
    const index = livePathIndex(this.hierarchy);
    return {
      results: rows.map((row) => ({
        note: toNoteSummary(row, index),
        title: row.title_marked !== null ? parseMarked(displayTitle(row.title_marked)) : markSubstring(displayTitle(row.title), text),
        snippet: parseMarked(row.body.replace(/\s+/g, ' ').trim()),
      })),
    };
  }
}
