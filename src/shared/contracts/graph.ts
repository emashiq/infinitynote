import { z } from 'zod';
import { DocumentKindSchema } from './hierarchy';
import { Uuid } from './ids';
import { TagName } from './tags';

/**
 * The relation graph (F10, D-170): notes and documents as nodes, their links as edges. Main builds the model in one
 * bounded set of queries; the renderer lays it out and draws it.
 */
export const MAX_GRAPH_NODES = 5_000;
export const MAX_GRAPH_EDGES = 20_000;
export const MAX_LOCAL_DEPTH = 3;

export const GraphScope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({ kind: z.literal('common') }),
  z.strictObject({ kind: z.literal('project'), projectId: Uuid }),
  /** A folder and every folder under it. */
  z.strictObject({ kind: z.literal('folder'), folderId: Uuid }),
]);
export type GraphScopeType = z.infer<typeof GraphScope>;

export const GraphItemKind = z.enum(['note', 'document']);
export type GraphItemKindType = z.infer<typeof GraphItemKind>;

export const GraphNode = z.strictObject({
  kind: GraphItemKind,
  id: Uuid,
  /** A document's kind; null for notes. */
  documentKind: DocumentKindSchema.nullable(),
  /** The title only; a locked note shows nothing else (D-111). */
  title: z.string().max(200),
  locked: z.boolean(),
  projectId: Uuid.nullable(),
  folderId: Uuid.nullable(),
  /** Links to and from the node within the graph. */
  degree: z.number().int().min(0),
});
export type GraphNodeType = z.infer<typeof GraphNode>;

/**
 * Why two items are joined: a link to a note (`reference`), a link to a document (`documentLink`), or a document opened
 * in the app from a note's attached or linked file (`file`). Edges name their ends by index in the node list.
 */
export const GraphEdgeKind = z.enum(['reference', 'documentLink', 'file']);
export type GraphEdgeKindType = z.infer<typeof GraphEdgeKind>;
export const GraphEdge = z.strictObject({ source: z.number().int().min(0), target: z.number().int().min(0), kind: GraphEdgeKind });
export type GraphEdgeType = z.infer<typeof GraphEdge>;

export const GraphModel = z
  .strictObject({
    nodes: z.array(GraphNode).max(MAX_GRAPH_NODES),
    edges: z.array(GraphEdge).max(MAX_GRAPH_EDGES),
    /** Nodes or edges were left out at the limits. */
    truncated: z.boolean(),
  })
  .refine((m) => m.edges.every((e) => e.source < m.nodes.length && e.target < m.nodes.length && e.source !== e.target), {
    message: 'An edge names a node that is not in the graph',
  });
export type GraphModelType = z.infer<typeof GraphModel>;

export const GraphBuildRequest = z.strictObject({
  scope: GraphScope,
  kinds: z.array(GraphItemKind).min(1).max(2),
  /** Notes must carry the tag (documents carry no tags, so a tag shows notes only). */
  tag: TagName.nullable(),
  /** Items without any link in the graph. */
  includeOrphans: z.boolean(),
});
export type GraphBuildRequestType = z.infer<typeof GraphBuildRequest>;

export const GraphLocalRequest = z.strictObject({
  item: z.strictObject({ kind: GraphItemKind, id: Uuid }),
  depth: z.number().int().min(1).max(MAX_LOCAL_DEPTH),
});
export type GraphLocalRequestType = z.infer<typeof GraphLocalRequest>;
