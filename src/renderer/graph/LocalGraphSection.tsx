import { useEffect, useMemo, useState } from 'react';
import { MAX_LOCAL_DEPTH, type GraphItemKindType, type GraphModelType } from '../../shared/contracts/graph';
import { PanelSection } from '../panel/PanelSection';
import { useServices, useStore } from '../state/use-store';
import { SegmentedControl } from '../ui/SegmentedControl';
import { GraphCanvas } from './GraphCanvas';
import { openGraphNode } from './GraphPage';

const DEPTHS = Array.from({ length: MAX_LOCAL_DEPTH }, (_, i) => String(i + 1) as '1' | '2' | '3');

/** "Local graph" in the Details panel (D-170): the item and what is within 1 to 3 links of it; a click opens an item. */
export function LocalGraphSection({ item }: { item: { kind: GraphItemKindType; id: string } }) {
  const services = useServices();
  const { bridge, tree } = services;
  const { snapshot } = useStore(tree.store);
  const [depth, setDepth] = useState<'1' | '2' | '3'>('1');
  const [model, setModel] = useState<GraphModelType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { kind, id } = item;

  // Read again when the tree changes (renames, moves, Trash); links made since show when the section opens again.
  useEffect(() => {
    let current = true;
    void bridge.graph.local({ item: { kind, id }, depth: Number(depth) }).then((res) => {
      if (!current) return;
      setModel(res.ok ? res.data : null);
      setError(res.ok ? null : res.error.message);
    });
    return () => {
      current = false;
    };
  }, [bridge, kind, id, depth, snapshot]);

  const self = useMemo(() => {
    const i = model?.nodes.findIndex((n) => n.kind === kind && n.id === id) ?? -1;
    return new Set(i >= 0 ? [i] : []);
  }, [model, kind, id]);

  return (
    <PanelSection title="Local graph" className="local-graph-section">
      <SegmentedControl
        label="Links away"
        name="local-graph-depth"
        options={DEPTHS.map((d) => ({ value: d, label: d === '1' ? '1 link' : `${d} links` }))}
        value={depth}
        onChange={setDepth}
      />
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
      {model && model.nodes.length <= 1 ? <p className="muted">No links yet</p> : null}
      {model && model.nodes.length > 1 ? (
        <GraphCanvas model={model} highlight={null} ringed={self} label="Local graph" className="graph-local" onOpen={(node) => openGraphNode(services, node)} />
      ) : null}
    </PanelSection>
  );
}
