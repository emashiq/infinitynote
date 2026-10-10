import { z } from 'zod';
import { DocumentSummary, NoteSummary } from './hierarchy';
import { Uuid } from './ids';

export const HomeScope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({ kind: z.literal('common') }),
  z.strictObject({ kind: z.literal('project'), projectId: Uuid }),
]);
export type HomeScopeType = z.infer<typeof HomeScope>;

export const HomeSummaryRequest = z.strictObject({ scope: HomeScope });
export const HomeSummaryResponse = z.strictObject({
  scope: HomeScope,
  scopeValid: z.boolean(),
  pinned: z.array(NoteSummary).max(100),
  pinnedTotal: z.number().int().min(0),
  recent: z.array(NoteSummary).max(10),
  /** The most recently changed documents (D-118); Home lists them with the recent notes. */
  recentDocuments: z.array(DocumentSummary).max(10),
});
export type HomeSummaryType = z.infer<typeof HomeSummaryResponse>;
