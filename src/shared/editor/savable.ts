import type { RichDocLike } from './doc-schema';

interface JsonNode {
  attrs?: Record<string, unknown> | null;
  content?: JsonNode[];
  [key: string]: unknown;
}

function savableNodes(nodes: JsonNode[] | undefined): JsonNode[] | undefined {
  if (!nodes) return undefined;
  const out: JsonNode[] = [];
  for (const node of nodes) {
    // A node still uploading has no attachment yet; it is saved once the upload completes.
    if (node.attrs && typeof node.attrs.uploadToken === 'string') continue;
    out.push(node.content ? { ...node, content: savableNodes(node.content) } : node);
  }
  return out;
}

/** An editor document as it is saved: transient upload nodes removed (main normalizes the rest). */
export function toSavable(json: { type?: unknown; content?: unknown[] }): RichDocLike {
  return { type: 'doc', content: savableNodes(json.content as JsonNode[] | undefined) ?? [] };
}
