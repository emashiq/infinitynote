import type { GraphBuildRequestType, GraphItemKindType, GraphLocalRequestType, GraphModelType } from '../../shared/contracts/graph';
import type { Db } from '../db/driver';
import { buildGraphModel, type GraphItem, type GraphLink } from './graph-model';
import { GraphRepo } from './graph-repo';

/**
 * The relation graph of notes and documents (F10, D-170): one read of the items in scope and one of each kind of link,
 * in a single read transaction, then the bounded model. Locked notes are nodes by title only.
 */
export class GraphService {
  private readonly repo: GraphRepo;

  constructor(private readonly db: Db) {
    this.repo = new GraphRepo(db);
  }

  build(req: GraphBuildRequestType): GraphModelType {
    return this.db.transaction(() => {
      const kinds = new Set(req.kinds);
      const items: GraphItem[] = [
        ...(kinds.has('note') ? this.noteItems(req) : []),
        // Documents carry no tags: a tag filter shows tagged notes only.
        ...(kinds.has('document') && req.tag === null ? this.documentItems(req) : []),
      ];
      return buildGraphModel({ items, links: this.links(), includeOrphans: req.includeOrphans });
    });
  }

  /** The items within `depth` links of one item (in any direction, across every scope), with the links between them. */
  local(req: GraphLocalRequestType): GraphModelType {
    return this.db.transaction(() => {
      const all = [...this.noteItems({ scope: { kind: 'all' }, tag: null }), ...this.documentItems({ scope: { kind: 'all' } })];
      const links = this.links();
      const start = `${req.item.kind}:${req.item.id}`;
      if (!all.some((i) => `${i.kind}:${i.id}` === start)) return { nodes: [], edges: [], truncated: false };
      const near = withinDepth(start, links, req.depth);
      return buildGraphModel({ items: all.filter((i) => near.has(`${i.kind}:${i.id}`)), links, includeOrphans: true });
    });
  }

  private noteItems(req: Pick<GraphBuildRequestType, 'scope' | 'tag'>): GraphItem[] {
    return this.repo.notes(req.scope, req.tag).map((n) => ({
      kind: 'note',
      id: n.id,
      documentKind: null,
      title: n.title,
      locked: n.locked === 1,
      projectId: n.project_id,
      folderId: n.folder_id,
    }));
  }

  private documentItems(req: Pick<GraphBuildRequestType, 'scope'>): GraphItem[] {
    return this.repo.documents(req.scope).map((d) => ({
      kind: 'document',
      id: d.id,
      documentKind: d.kind,
      title: d.title,
      locked: false,
      projectId: d.project_id,
      folderId: d.folder_id,
    }));
  }

  private links(): GraphLink[] {
    const of = (rows: Array<{ source_id: string; target_id: string }>, target: GraphItemKindType, kind: GraphLink['kind']): GraphLink[] =>
      rows.map((r) => ({ from: { kind: 'note', id: r.source_id }, to: { kind: target, id: r.target_id }, kind }));
    return [...of(this.repo.noteLinks(), 'note', 'reference'), ...of(this.repo.documentLinks(), 'document', 'documentLink'), ...of(this.repo.fileLinks(), 'document', 'file')];
  }
}

/** Breadth-first over links as undirected edges: the keys of every item at most `depth` links away from `start`. */
function withinDepth(start: string, links: readonly GraphLink[], depth: number): Set<string> {
  const neighbors = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    const list = neighbors.get(a);
    if (list) list.push(b);
    else neighbors.set(a, [b]);
  };
  for (const l of links) {
    const a = `${l.from.kind}:${l.from.id}`;
    const b = `${l.to.kind}:${l.to.id}`;
    add(a, b);
    add(b, a);
  }
  const seen = new Set([start]);
  let frontier = [start];
  for (let d = 0; d < depth && frontier.length > 0; d += 1) {
    const next: string[] = [];
    for (const key of frontier) {
      for (const n of neighbors.get(key) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return seen;
}
