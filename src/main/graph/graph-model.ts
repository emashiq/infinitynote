import {
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  type GraphEdgeKindType,
  type GraphEdgeType,
  type GraphItemKindType,
  type GraphModelType,
  type GraphNodeType,
} from '../../shared/contracts/graph';

export type GraphItem = Omit<GraphNodeType, 'degree'>;

export interface GraphLink {
  from: { kind: GraphItemKindType; id: string };
  to: { kind: GraphItemKindType; id: string };
  kind: GraphEdgeKindType;
}

export interface GraphLimits {
  nodes: number;
  edges: number;
}

const keyOf = (item: { kind: GraphItemKindType; id: string }): string => `${item.kind}:${item.id}`;

/**
 * The graph of a set of items and the links between them (D-170), pure so it can be measured on its own: links whose
 * ends are not both among the items are left out, a pair of items is joined once per kind of link whatever its
 * direction, and items without links are kept only with `includeOrphans`. At the limits the best-connected items are
 * kept (ties by the order given) and `truncated` says so.
 */
export function buildGraphModel(input: {
  items: readonly GraphItem[];
  links: readonly GraphLink[];
  includeOrphans: boolean;
  limits?: GraphLimits;
}): GraphModelType {
  const limits = input.limits ?? { nodes: MAX_GRAPH_NODES, edges: MAX_GRAPH_EDGES };
  const index = new Map<string, number>();
  input.items.forEach((item, i) => index.set(keyOf(item), i));

  const pairs = new Set<string>();
  const joined: Array<{ a: number; b: number; kind: GraphEdgeKindType }> = [];
  const degree = new Array<number>(input.items.length).fill(0);
  for (const link of input.links) {
    const a = index.get(keyOf(link.from));
    const b = index.get(keyOf(link.to));
    if (a === undefined || b === undefined || a === b) continue;
    const pair = a < b ? `${a}-${b}-${link.kind}` : `${b}-${a}-${link.kind}`;
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    joined.push({ a, b, kind: link.kind });
    degree[a]! += 1;
    degree[b]! += 1;
  }

  let candidates = input.items.map((_, i) => i).filter((i) => input.includeOrphans || degree[i]! > 0);
  let truncated = false;
  if (candidates.length > limits.nodes) {
    truncated = true;
    candidates = [...candidates].sort((x, y) => degree[y]! - degree[x]! || x - y).slice(0, limits.nodes).sort((x, y) => x - y);
  }
  const position = new Map<number, number>();
  candidates.forEach((item, i) => position.set(item, i));

  const edges: GraphEdgeType[] = [];
  const kept = new Array<number>(candidates.length).fill(0);
  for (const e of joined) {
    const source = position.get(e.a);
    const target = position.get(e.b);
    if (source === undefined || target === undefined) continue;
    if (edges.length >= limits.edges) {
      truncated = true;
      break;
    }
    edges.push({ source, target, kind: e.kind });
    kept[source]! += 1;
    kept[target]! += 1;
  }
  const nodes = candidates.map((item, i) => ({ ...input.items[item]!, degree: kept[i]! }));
  return { ...(input.includeOrphans ? { nodes, edges } : dropUnlinked(nodes, edges)), truncated };
}

/** Without orphans, items that lost all their edges at the edge limit leave too; edge ends are renumbered. */
function dropUnlinked(nodes: GraphNodeType[], edges: GraphEdgeType[]): { nodes: GraphNodeType[]; edges: GraphEdgeType[] } {
  if (nodes.every((n) => n.degree > 0)) return { nodes, edges };
  const renumbered = new Map<number, number>();
  const linked = nodes.filter((n, i) => {
    if (n.degree === 0) return false;
    renumbered.set(i, renumbered.size);
    return true;
  });
  return { nodes: linked, edges: edges.map((e) => ({ ...e, source: renumbered.get(e.source)!, target: renumbered.get(e.target)! })) };
}
