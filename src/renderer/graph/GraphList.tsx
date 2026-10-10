import { FileText, Lock } from 'lucide-react';
import { useMemo } from 'react';
import type { GraphModelType, GraphNodeType } from '../../shared/contracts/graph';
import { DocumentKindIcon } from '../ui/DocumentKindIcon';
import { neighborsOf } from './GraphCanvas';
import { labelOf } from './graph-draw';

function ItemIcon({ node }: { node: GraphNodeType }) {
  if (node.kind === 'document' && node.documentKind) return <DocumentKindIcon kind={node.documentKind} size={14} />;
  return node.locked ? <Lock size={14} strokeWidth={1.75} aria-hidden /> : <FileText size={14} strokeWidth={1.75} aria-hidden />;
}

/**
 * The graph as a list (D-170), for the keyboard and screen readers: every item, by title, with the items it is linked
 * with; each opens in a tab. `only` limits it to search matches.
 */
export function GraphList({ model, only, onOpen }: { model: GraphModelType; only: ReadonlySet<number> | null; onOpen: (node: GraphNodeType) => void }) {
  const neighbors = useMemo(() => neighborsOf(model), [model]);
  const order = useMemo(
    () =>
      model.nodes
        .map((_, i) => i)
        .filter((i) => only === null || only.has(i))
        .sort((a, b) => labelOf(model.nodes[a]!).localeCompare(labelOf(model.nodes[b]!))),
    [model, only],
  );
  if (order.length === 0) return <p className="muted">No items match</p>;
  const open = (i: number) => {
    const node = model.nodes[i]!;
    return (
      <button type="button" className="graph-list-open" onClick={() => onOpen(node)}>
        <ItemIcon node={node} />
        {labelOf(node)}
      </button>
    );
  };
  return (
    <ul className="graph-list" aria-label="Items and their links">
      {order.map((i) => {
        const linked = [...neighbors[i]!];
        return (
          <li key={`${model.nodes[i]!.kind}:${model.nodes[i]!.id}`}>
            {open(i)}
            <span className="muted"> {linked.length === 1 ? '1 link' : `${linked.length} links`}</span>
            {linked.length > 0 ? (
              <ul className="graph-list-links" aria-label={`Linked with ${labelOf(model.nodes[i]!)}`}>
                {linked.map((j) => (
                  <li key={j}>{open(j)}</li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
