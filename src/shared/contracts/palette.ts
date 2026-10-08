import { z } from 'zod';
import { NoteSummary } from './hierarchy';

export const PaletteSearchRequest = z.strictObject({
  query: z.string().max(200),
  limit: z.number().int().min(1).max(50).optional(),
});
export const PaletteSearchResponse = z.strictObject({ results: z.array(NoteSummary) });
