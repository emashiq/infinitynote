import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MAX_GRAPH_EDGES, MAX_GRAPH_NODES, type GraphItemKindType, type GraphNodeType, type GraphScopeType } from '../../shared/contracts/graph';
import { DOCUMENT_KIND_INFO, DOCUMENT_KINDS } from '../../shared/documents/kinds';
import type { AppServices } from '../state/app-services';
import { useServices, useStore } from '../state/use-store';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Switch } from '../ui/Switch';
import { GraphCanvas } from './GraphCanvas';
import { GraphList } from './GraphList';
import { matchNodes } from './graph-search';

/** Opens a graph node's item in a tab. */
export function openGraphNode(services: Pick<AppServices, 'tabs'>, node: GraphNodeType): void {
  if (node.kind === 'note') void services.tabs.openNote(node.id);
  else void services.tabs.openDocument(node.id);
}

const scopeValue = (scope: GraphScopeType): string =>
  scope.kind === 'project' ? `project:${scope.projectId}` : scope.kind === 'folder' ? `folder:${scope.folderId}` : scope.kind;

function scopeFrom(value: string): GraphScopeType {
  if (value.startsWith('project:')) return { kind: 'project', projectId: value.slice('project:'.length) };
  if (value.startsWith('folder:')) return { kind: 'folder', folderId: value.slice('folder:'.length) };
  return value === 'common' ? { kind: 'common' } : { kind: 'all' };
}

/** What the colors and shapes mean. */
function GraphLegend() {
  return (
    <ul className="graph-legend" aria-label="Legend">
      <li>
        <span className="graph-swatch graph-swatch-note" aria-hidden />
        Note
      </li>
      <li>
        <span className="graph-swatch graph-swatch-note graph-swatch-locked" aria-hidden />
        Locked note
      </li>
      {DOCUMENT_KINDS.map((kind) => (
        <li key={kind}>
          <span className={`graph-swatch graph-swatch-document graph-swatch-${kind}`} aria-hidden />
          {DOCUMENT_KIND_INFO[kind].label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The Graph page (F10, D-170): notes and documents of a scope with their links, drawn or as a list, filtered by kind
 * and tag, with or without unlinked items; search highlights titles; a click opens the item.
 */
export function GraphPage() {
  const services = useServices();
  const { graph, tree, bridge } = services;
  const s = useStore(graph.store);
  const { snapshot } = useStore(tree.store);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    void bridge.tags.list({}).then((res) => {
      if (res.ok) setTags(res.data.tags.map((t) => t.name));
    });
  }, [bridge]);
  // The graph follows the tree: items created, renamed, moved, trashed or restored elsewhere.
  useEffect(() => {
    const timer = setTimeout(() => void graph.load(), 250);
    return () => clearTimeout(timer);
  }, [graph, snapshot]);

  const model = s.model;
  const matches = useMemo(() => (model ? matchNodes(model, query) : null), [model, query]);
  const { filters } = s;
  const folderScope = filters.scope.kind === 'folder' ? filters.scope : null;
  const folder = folderScope ? snapshot.folders.find((f) => f.id === folderScope.folderId) : undefined;
  const toggleKind = (kind: GraphItemKindType, on: boolean) => {
    const kinds = on ? [...new Set([...filters.kinds, kind])] : filters.kinds.filter((k) => k !== kind);
    if (kinds.length > 0) void graph.setFilters({ kinds });
  };
  const onOpen = (node: GraphNodeType) => openGraphNode(services, node);

  return (
    <div className="page graph-page">
      <div className="page-header graph-header">
        <h2 className="view-title">Graph</h2>
        <label className="graph-field">
          <span>Show</span>
          <select className="text-input" value={scopeValue(filters.scope)} onChange={(e) => void graph.setFilters({ scope: scopeFrom(e.target.value) })}>
            <option value="all">All items</option>
            <option value="common">Common</option>
            {snapshot.projects.map((p) => (
              <option key={p.id} value={`project:${p.id}`}>
                {p.name}
              </option>
            ))}
            {folderScope ? <option value={scopeValue(folderScope)}>{folder ? `Folder ${folder.name}` : 'Folder'}</option> : null}
          </select>
        </label>
        <label className="graph-check">
          <input type="checkbox" checked={filters.kinds.includes('note')} onChange={(e) => toggleKind('note', e.target.checked)} />
          Notes
        </label>
        <label className="graph-check">
          <input type="checkbox" checked={filters.kinds.includes('document')} onChange={(e) => toggleKind('document', e.target.checked)} />
          Documents
        </label>
        <label className="graph-field">
          <span>Tag</span>
          <select className="text-input" value={filters.tag ?? ''} onChange={(e) => void graph.setFilters({ tag: e.target.value === '' ? null : e.target.value })}>
            <option value="">Any</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <Switch label="Unlinked items" checked={filters.includeOrphans} onChange={(includeOrphans) => void graph.setFilters({ includeOrphans })} />
        <input className="text-input graph-search" type="search" aria-label="Search the graph" placeholder="Search titles" value={query} onChange={(e) => setQuery(e.target.value)} />
        <SegmentedControl<'graph' | 'list'>
          label="View"
          name="graph-view"
          options={[
            { value: 'graph', label: 'Graph' },
            { value: 'list', label: 'List' },
          ]}
          value={view}
          onChange={setView}
        />
        <IconButton label="Refresh graph" icon={RefreshCw} onClick={() => void graph.load()} />
      </div>
      {s.status === 'error' ? (
        <p role="alert" className="field-error">
          {s.message}
        </p>
      ) : null}
      {model?.truncated ? (
        <p className="muted" role="status">
          Showing the {MAX_GRAPH_NODES.toLocaleString('en')} best-linked items and up to {MAX_GRAPH_EDGES.toLocaleString('en')} links. Narrow the scope to see the rest.
        </p>
      ) : null}
      {matches ? <p className="muted" role="status">{matches.size === 1 ? '1 item matches' : `${matches.size} items match`}</p> : null}
      {model && model.nodes.length === 0 ? <p className="muted">Nothing to show. Link notes and documents to see them here.</p> : null}
      {model && model.nodes.length > 0 ? (
        view === 'graph' ? (
          <GraphCanvas model={model} highlight={matches} label="Relation graph" className="graph-main" onOpen={onOpen} />
        ) : (
          <div className="graph-list-wrap">
            <GraphList model={model} only={matches} onOpen={onOpen} />
          </div>
        )
      ) : null}
      {s.status === 'loading' && !model ? <p className="muted">Building the graph…</p> : null}
      <GraphLegend />
    </div>
  );
}
