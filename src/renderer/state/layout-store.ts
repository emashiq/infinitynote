import type { InfinityBridge } from '../../shared/contracts/bridge';
import { createStore, type Store } from './store';

export const TREE_DRAWER_BELOW = 960;
export const PANEL_DRAWER_BELOW = 1180;
export const TREE_MIN = 220;
export const TREE_MAX = 280;
export const TREE_DEFAULT = 248;

export interface LayoutState {
  viewportWidth: number;
  treeMode: 'docked' | 'drawer';
  panelMode: 'docked' | 'drawer';
  treeOpen: boolean;
  panelOpen: boolean;
  treeWidth: number;
  treeDrawerOpen: boolean;
  panelDrawerOpen: boolean;
}

const modes = (width: number) => ({
  treeMode: width < TREE_DRAWER_BELOW ? ('drawer' as const) : ('docked' as const),
  panelMode: width < PANEL_DRAWER_BELOW ? ('drawer' as const) : ('docked' as const),
});

export const clampTreeWidth = (px: number): number => Math.max(TREE_MIN, Math.min(TREE_MAX, Math.round(Number.isFinite(px) ? px : TREE_DEFAULT)));

export class LayoutStore {
  readonly store: Store<LayoutState>;

  constructor(
    private readonly bridge: InfinityBridge,
    viewportWidth: number,
  ) {
    this.store = createStore<LayoutState>({
      viewportWidth,
      ...modes(viewportWidth),
      treeOpen: true,
      panelOpen: false,
      treeWidth: TREE_DEFAULT,
      treeDrawerOpen: false,
      panelDrawerOpen: false,
    });
  }

  hydrate(v: { treeOpen: boolean; panelOpen: boolean; treeWidth: number }): void {
    this.store.setState({ treeOpen: v.treeOpen, panelOpen: v.panelOpen, treeWidth: clampTreeWidth(v.treeWidth) });
  }

  setViewportWidth(width: number): void {
    this.store.setState((s) => {
      const next = modes(width);
      const changed = next.treeMode !== s.treeMode || next.panelMode !== s.panelMode;
      return {
        ...s,
        viewportWidth: width,
        ...next,
        treeDrawerOpen: changed ? false : s.treeDrawerOpen,
        panelDrawerOpen: changed ? false : s.panelDrawerOpen,
      };
    });
  }

  private persist(key: 'layout.treeOpen' | 'layout.panelOpen', value: boolean): void {
    void this.bridge.settings.set({ key, value });
  }

  /** True when the tree is currently visible (docked and open, or drawer open). */
  treeVisible(): boolean {
    const s = this.store.getState();
    return s.treeMode === 'docked' ? s.treeOpen : s.treeDrawerOpen;
  }
  panelVisible(): boolean {
    const s = this.store.getState();
    return s.panelMode === 'docked' ? s.panelOpen : s.panelDrawerOpen;
  }

  toggleTree(): void {
    const s = this.store.getState();
    if (s.treeMode === 'docked') {
      this.store.setState({ treeOpen: !s.treeOpen });
      this.persist('layout.treeOpen', !s.treeOpen);
    } else {
      this.store.setState({ treeDrawerOpen: !s.treeDrawerOpen, panelDrawerOpen: false });
    }
  }

  togglePanel(): void {
    const s = this.store.getState();
    if (s.panelMode === 'docked') {
      this.store.setState({ panelOpen: !s.panelOpen });
      this.persist('layout.panelOpen', !s.panelOpen);
    } else {
      this.store.setState({ panelDrawerOpen: !s.panelDrawerOpen, treeDrawerOpen: false });
    }
  }

  setTreeWidth(px: number, opts: { persist: boolean }): void {
    const width = clampTreeWidth(px);
    this.store.setState({ treeWidth: width });
    if (opts.persist) void this.bridge.settings.set({ key: 'layout.treeWidth', value: width });
  }

  closeDrawers(): void {
    this.store.setState({ treeDrawerOpen: false, panelDrawerOpen: false });
  }
}
