import type { GraphModelType } from '../../shared/contracts/graph';

/** The nodes whose title contains every word of the query (any case); null for an empty query (nothing highlighted). */
export function matchNodes(model: Pick<GraphModelType, 'nodes'>, query: string): Set<number> | null {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const out = new Set<number>();
  model.nodes.forEach((n, i) => {
    const title = n.title.toLocaleLowerCase();
    if (words.every((w) => title.includes(w))) out.add(i);
  });
  return out;
}
