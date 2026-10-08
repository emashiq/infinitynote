import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { HomeScopeType, HomeSummaryType } from '../../shared/contracts/home';
import { createStore, type Store } from './store';

export interface HomeState {
  scope: HomeScopeType;
  scopeValid: boolean;
  summary: HomeSummaryType | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
}

export class HomeStore {
  readonly store: Store<HomeState> = createStore<HomeState>({
    scope: { kind: 'all' },
    scopeValid: true,
    summary: null,
    status: 'idle',
  });
  private refreshing: Promise<void> | null = null;
  private again = false;

  constructor(private readonly bridge: InfinityBridge) {}

  hydrate(scope: HomeScopeType): void {
    this.store.setState({ scope });
  }

  load(): Promise<void> {
    return this.refresh();
  }

  /** Coalesced: a call during a fetch schedules exactly one more fetch. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      try {
        do {
          this.again = false;
          const requested = this.store.getState().scope;
          if (this.store.getState().summary === null) this.store.setState({ status: 'loading' });
          const res = await this.bridge.home.summary({ scope: requested });
          if (!res.ok) {
            this.store.setState({ status: 'error', error: res.error.message });
            continue;
          }
          const invalid = !res.data.scopeValid;
          this.store.setState({ summary: res.data, status: 'ready', scopeValid: res.data.scopeValid, scope: invalid ? res.data.scope : requested, error: undefined });
          if (invalid) {
            void this.bridge.settings.set({ key: 'home.scope', value: res.data.scope });
          }
        } while (this.again);
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async setScope(scope: HomeScopeType): Promise<void> {
    this.store.setState({ scope, scopeValid: true });
    void this.bridge.settings.set({ key: 'home.scope', value: scope });
    await this.refresh();
  }
}
