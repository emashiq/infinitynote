import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { GraphItemKindType, GraphModelType, GraphScopeType } from '../../shared/contracts/graph';
import { createStore, type Store } from '../state/store';
import type { TabsStore } from '../state/tabs-store';

export interface GraphFilters {
  scope: GraphScopeType;
  kinds: readonly GraphItemKindType[];
  tag: string | null;
  includeOrphans: boolean;
}

export interface GraphState {
  filters: GraphFilters;
  status: 'idle' | 'loading' | 'ready' | 'error';
  model: GraphModelType | null;
  message: string | null;
}

export const DEFAULT_GRAPH_FILTERS: GraphFilters = { scope: { kind: 'all' }, kinds: ['note', 'document'], tag: null, includeOrphans: true };

/** The Graph page's filters and the model main built for them (D-170); kept for the window's lifetime. */
export class GraphStore {
  readonly store: Store<GraphState> = createStore<GraphState>({ filters: DEFAULT_GRAPH_FILTERS, status: 'idle', model: null, message: null });
  private seq = 0;

  constructor(private readonly deps: { bridge: Pick<InfinityBridge, 'graph'>; tabs: Pick<TabsStore, 'openPage'> }) {}

  /** Opens the Graph tab on a scope (all, Common, a project or a folder). */
  async open(scope: GraphScopeType): Promise<void> {
    this.store.setState((s) => ({ ...s, filters: { ...s.filters, scope } }));
    if (await this.deps.tabs.openPage('graph')) await this.load();
  }

  setFilters(change: Partial<GraphFilters>): Promise<void> {
    this.store.setState((s) => ({ ...s, filters: { ...s.filters, ...change } }));
    return this.load();
  }

  async load(): Promise<void> {
    const seq = ++this.seq;
    const { filters } = this.store.getState();
    this.store.setState({ status: 'loading' });
    const res = await this.deps.bridge.graph.build({ scope: filters.scope, kinds: [...filters.kinds], tag: filters.tag, includeOrphans: filters.includeOrphans });
    if (seq !== this.seq) return;
    if (res.ok) this.store.setState({ status: 'ready', model: res.data, message: null });
    else this.store.setState({ status: 'error', message: res.error.message });
  }
}
