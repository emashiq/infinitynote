import type { GraphItem, GraphLink } from '../../src/main/graph/graph-model';

/** A stable UUID per number, so graph tests can name items by index. */
export const graphId = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const graphNote = (n: number, title = `Note ${n}`): GraphItem => ({ kind: 'note', id: graphId(n), documentKind: null, title, locked: false, projectId: null, folderId: null });

export const graphRef = (a: number, b: number, kind: GraphLink['kind'] = 'reference', toKind: GraphItem['kind'] = 'note'): GraphLink => ({
  from: { kind: 'note', id: graphId(a) },
  to: { kind: toKind, id: graphId(b) },
  kind,
});

/** A synthetic graph: `nodes` notes, `edges` links between pseudo-random distinct pairs (deterministic). */
export function syntheticGraph(nodes: number, edges: number): { items: GraphItem[]; links: GraphLink[] } {
  const items = Array.from({ length: nodes }, (_, i) => graphNote(i));
  const links: GraphLink[] = [];
  let seed = 7;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const used = new Set<string>();
  while (links.length < edges) {
    const a = next() % nodes;
    const b = next() % nodes;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (a === b || used.has(key)) continue;
    used.add(key);
    links.push(graphRef(a, b));
  }
  return { items, links };
}
