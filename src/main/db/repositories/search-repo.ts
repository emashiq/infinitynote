import type { HomeScopeType } from '../../../shared/contracts/home';
import { HIT_END, HIT_START } from '../../../shared/search/segments';
import type { Db } from '../driver';
import { NOTE_META_COLS, scopeFilter, type NoteMetaRow } from './hierarchy-repo';

export interface SearchRow extends NoteMetaRow {
  /** The title with FTS5 hit markers (full-text queries only). */
  title_marked: string | null;
  /** A body excerpt: with hit markers for full-text queries, the start of the text otherwise. */
  body: string;
}

export interface SearchFilters {
  scope: HomeScopeType;
  /** Notes must carry every tag. */
  tags: readonly string[];
}

const META = NOTE_META_COLS.split(', ')
  .map((c) => `n.${c}`)
  .join(', ');
/** Tokens of body context around the best hit (FTS5 snippet). */
const SNIPPET_TOKENS = 16;
/** Characters of body shown for title-only matches. */
const BODY_PREVIEW_CHARS = 120;

/** Live-note, scope and tag conditions on `n`. */
function filterSql(f: SearchFilters): { where: string; args: unknown[] } {
  const scope = scopeFilter(f.scope, 'n.project_id');
  let where = ` AND n.deleted_at IS NULL${scope.where}`;
  const args: unknown[] = [...scope.args];
  if (f.tags.length > 0) {
    where += ` AND n.id IN (SELECT nt.note_id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
                WHERE t.name IN (SELECT value FROM json_each(?)) GROUP BY nt.note_id HAVING count(*) = ?)`;
    args.push(JSON.stringify(f.tags), f.tags.length);
  }
  return { where, args };
}

/** Full-text and title queries over live notes (INF-SRCH-01..05). */
export class SearchRepo {
  constructor(private readonly db: Db) {}

  /** FTS5 match over title and body, title hits weighted ten times, best first. */
  fullText(match: string, f: SearchFilters, limit: number): SearchRow[] {
    const { where, args } = filterSql(f);
    return this.db
      .prepare<unknown[], SearchRow>(
        `SELECT ${META},
                highlight(notes_fts, 0, ?, ?) AS title_marked,
                snippet(notes_fts, 1, ?, ?, '…', ${SNIPPET_TOKENS}) AS body
           FROM notes_fts JOIN notes n ON n.doc_key = notes_fts.rowid
          WHERE notes_fts MATCH ?${where}
          ORDER BY bm25(notes_fts, 10.0, 1.0), n.updated_at DESC
          LIMIT ?`,
      )
      .all(HIT_START, HIT_END, HIT_START, HIT_END, match, ...args, limit);
  }

  /** Titles containing the text (case-insensitive for ASCII), titles starting with it first, then most recent. */
  titleContains(text: string, f: SearchFilters, limit: number): SearchRow[] {
    const { where, args } = filterSql(f);
    return this.db
      .prepare<unknown[], SearchRow>(
        `SELECT ${META}, NULL AS title_marked, substr(n.plain_text, 1, ${BODY_PREVIEW_CHARS}) AS body
           FROM notes n
          WHERE instr(lower(n.title), lower(?)) > 0${where}
          ORDER BY instr(lower(n.title), lower(?)) = 1 DESC, n.updated_at DESC
          LIMIT ?`,
      )
      .all(text, ...args, text, limit);
  }

  /** The most recently updated notes that pass the filters (a tag filter without a query). */
  recent(f: SearchFilters, limit: number): SearchRow[] {
    const { where, args } = filterSql(f);
    return this.db
      .prepare<unknown[], SearchRow>(
        `SELECT ${META}, NULL AS title_marked, substr(n.plain_text, 1, ${BODY_PREVIEW_CHARS}) AS body
           FROM notes n WHERE 1 = 1${where} ORDER BY n.updated_at DESC LIMIT ?`,
      )
      .all(...args, limit);
  }
}
