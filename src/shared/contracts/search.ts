import { z } from 'zod';
import { DocumentSummary, NoteSummary } from './hierarchy';
import { HomeScope } from './home';
import { TagName } from './tags';

/** At most this many results per query (INF-SRCH-05); the renderer never lists the whole notebook. */
export const MAX_SEARCH_RESULTS = 50;
/** The palette waits this long after the last keystroke before it searches. */
export const SEARCH_DEBOUNCE_MS = 150;
/** Queries of this many characters or fewer match titles by substring instead of the full-text index. */
export const SHORT_QUERY_CHARS = 2;

export const Segment = z.strictObject({ text: z.string(), hit: z.boolean() });

export const SearchQueryRequest = z.strictObject({
  query: z.string().max(200),
  scope: HomeScope.optional(),
  /** Notes must carry every one of these tags. */
  tags: z.array(TagName).max(20).optional(),
  limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
});
export type SearchQueryRequestType = z.infer<typeof SearchQueryRequest>;

export const SearchResult = z.strictObject({
  note: NoteSummary,
  title: z.array(Segment),
  snippet: z.array(Segment),
});
export type SearchResultType = z.infer<typeof SearchResult>;

/** A document whose title or extracted text matches (D-118); documents carry no tags, so a tag filter finds none. */
export const DocumentSearchResult = z.strictObject({
  document: DocumentSummary,
  title: z.array(Segment),
  snippet: z.array(Segment),
});
export type DocumentSearchResultType = z.infer<typeof DocumentSearchResult>;

export const SearchQueryResponse = z.strictObject({
  results: z.array(SearchResult).max(MAX_SEARCH_RESULTS),
  documents: z.array(DocumentSearchResult).max(MAX_SEARCH_RESULTS),
});
export type SearchQueryResponseType = z.infer<typeof SearchQueryResponse>;
