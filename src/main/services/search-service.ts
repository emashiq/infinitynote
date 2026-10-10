import { MAX_SEARCH_RESULTS, SHORT_QUERY_CHARS, type SearchQueryRequestType, type SearchQueryResponseType } from '../../shared/contracts/search';
import { displayTitle } from '../../shared/names';
import { markSubstring, parseMarked } from '../../shared/search/segments';
import type { Db } from '../db/driver';
import { HierarchyRepo } from '../db/repositories/hierarchy-repo';
import { SearchRepo, type DocumentSearchRow, type SearchFilters, type SearchRow } from '../db/repositories/search-repo';
import { livePathIndex, toDocumentSummary, toNoteSummary } from './dto';

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

/**
 * Note and document search for the palette (INF-SRCH-01..05, D-118): bounded, filtered by scope and tags (documents
 * carry no tags, so a tag filter lists notes only), with safe highlight segments.
 */
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
    let rows: SearchRow[] = [];
    let documents: DocumentSearchRow[] = [];
    if (text === '') {
      rows = filters.tags.length > 0 ? this.repo.recent(filters, limit) : [];
    } else if ([...text].length <= SHORT_QUERY_CHARS) {
      rows = this.repo.titleContains(text, filters, limit);
      if (filters.tags.length === 0) documents = this.repo.documentsTitleContains(text, filters.scope, limit);
    } else {
      const match = toFtsQuery(text);
      if (match) {
        rows = this.repo.fullText(match, filters, limit);
        if (filters.tags.length === 0) documents = this.repo.documentsFullText(match, filters.scope, limit);
        ({ rows, documents } = this.withCommentHits(match, filters, limit, rows, documents));
      }
    }
    if (rows.length === 0 && documents.length === 0) return { results: [], documents: [] };
    const index = livePathIndex(this.hierarchy);
    return {
      results: rows.map((row) => ({ note: toNoteSummary(row, index), ...segmentsOf(row, text) })),
      documents: documents.map((row) => ({ document: toDocumentSummary(row, index), ...segmentsOf(row, text) })),
    };
  }

  /**
   * Items whose comments match (D-165) follow the items whose own text matches, with the comment as their snippet; an
   * item already found keeps its own snippet. Scope and tag filters apply as for any result.
   */
  private withCommentHits(
    match: string,
    filters: SearchFilters,
    limit: number,
    rows: SearchRow[],
    documents: DocumentSearchRow[],
  ): { rows: SearchRow[]; documents: DocumentSearchRow[] } {
    const hits = this.repo.commentHits(match, limit);
    if (hits.length === 0) return { rows, documents };
    const snippets = new Map(hits.map((h) => [`${h.target_kind}:${h.target_id}`, `${COMMENT_SNIPPET_PREFIX}${h.body}`]));
    const found = new Set([...rows.map((r) => `note:${r.id}`), ...documents.map((d) => `document:${d.id}`)]);
    const fresh = (kind: 'note' | 'document') => hits.filter((h) => h.target_kind === kind && !found.has(`${kind}:${h.target_id}`)).map((h) => h.target_id);
    const withSnippet = <R extends { id: string; body: string }>(kind: string, list: R[]) => list.map((r) => ({ ...r, body: snippets.get(`${kind}:${r.id}`) ?? r.body }));
    const moreNotes = withSnippet('note', this.repo.notesByIds(fresh('note'), filters));
    const moreDocuments = filters.tags.length === 0 ? withSnippet('document', this.repo.documentsByIds(fresh('document'), filters.scope)) : [];
    return { rows: [...rows, ...moreNotes].slice(0, limit), documents: [...documents, ...moreDocuments].slice(0, limit) };
  }
}

/** How a result found by one of its comments introduces the snippet. */
export const COMMENT_SNIPPET_PREFIX = 'Comment: ';

/** Highlight segments of a result's title and snippet, never raw markup (D-098). */
function segmentsOf(row: { title: string; title_marked: string | null; body: string }, text: string) {
  return {
    title: row.title_marked !== null ? parseMarked(displayTitle(row.title_marked)) : markSubstring(displayTitle(row.title), text),
    snippet: parseMarked(row.body.replace(/\s+/g, ' ').trim()),
  };
}
