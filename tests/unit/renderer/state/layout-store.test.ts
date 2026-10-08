import { describe, expect, it } from 'vitest';
import { LayoutStore, clampTreeWidth } from '../../../../src/renderer/state/layout-store';
import { createFakeBridge } from '../support/fake-bridge';

function make(width: number) {
  const fake = createFakeBridge();
  return { fake, layout: new LayoutStore(fake.bridge, width) };
}
const sets = (fake: ReturnType<typeof createFakeBridge>) => fake.callsTo('settings:set').map((c) => c.req);

describe('LayoutStore (INF-SHELL-02..04)', () => {
  it('uses docked or drawer modes at the 960 and 1180 breakpoints', () => {
    for (const [width, tree, panel] of [
      [959, 'drawer', 'drawer'],
      [960, 'docked', 'drawer'],
      [1179, 'docked', 'drawer'],
      [1180, 'docked', 'docked'],
      [720, 'drawer', 'drawer'],
    ] as const) {
      const { layout } = make(width);
      expect(layout.store.getState(), String(width)).toMatchObject({ treeMode: tree, panelMode: panel, viewportWidth: width });
    }
  });

  it('clamps the tree width to 220..280', () => {
    expect(clampTreeWidth(500)).toBe(280);
    expect(clampTreeWidth(10)).toBe(220);
    expect(clampTreeWidth(250.4)).toBe(250);
    expect(clampTreeWidth(Number.NaN)).toBe(248);
    const { layout, fake } = make(1280);
    layout.setTreeWidth(500, { persist: true });
    layout.setTreeWidth(231, { persist: false });
    expect(layout.store.getState().treeWidth).toBe(231);
    expect(sets(fake)).toEqual([{ key: 'layout.treeWidth', value: 280 }]);
  });

  it('docked toggles flip and persist the setting', () => {
    const { layout, fake } = make(1280);
    layout.toggleTree();
    layout.togglePanel();
    expect(layout.store.getState()).toMatchObject({ treeOpen: false, panelOpen: false });
    layout.toggleTree();
    expect(sets(fake)).toEqual([
      { key: 'layout.treeOpen', value: false },
      { key: 'layout.panelOpen', value: false },
      { key: 'layout.treeOpen', value: true },
    ]);
    expect(layout.treeVisible()).toBe(true);
    expect(layout.panelVisible()).toBe(false);
  });

  it('drawer toggles open one drawer at a time and do not persist', () => {
    const { layout, fake } = make(800);
    layout.toggleTree();
    expect(layout.store.getState()).toMatchObject({ treeDrawerOpen: true, panelDrawerOpen: false, treeOpen: true });
    layout.togglePanel();
    expect(layout.store.getState()).toMatchObject({ treeDrawerOpen: false, panelDrawerOpen: true });
    layout.closeDrawers();
    expect(layout.store.getState()).toMatchObject({ treeDrawerOpen: false, panelDrawerOpen: false });
    expect(sets(fake)).toEqual([]);
  });

  it('closes drawers when the mode changes on resize, and keeps them otherwise', () => {
    const { layout } = make(800);
    layout.toggleTree();
    layout.setViewportWidth(850);
    expect(layout.store.getState().treeDrawerOpen).toBe(true);
    layout.setViewportWidth(1000);
    expect(layout.store.getState()).toMatchObject({ treeMode: 'docked', treeDrawerOpen: false });
    layout.togglePanel();
    layout.toggleTree();
    expect(layout.store.getState().panelDrawerOpen).toBe(true);
    layout.setViewportWidth(1200);
    expect(layout.store.getState()).toMatchObject({ panelMode: 'docked', panelDrawerOpen: false });
  });

  it('hydrate applies stored values with clamping', () => {
    const { layout } = make(1280);
    layout.hydrate({ treeOpen: false, panelOpen: false, treeWidth: 400 });
    expect(layout.store.getState()).toMatchObject({ treeOpen: false, panelOpen: false, treeWidth: 280 });
  });
});
