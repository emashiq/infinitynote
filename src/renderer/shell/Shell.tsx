import { useEffect, useState, type CSSProperties } from 'react';
import { CommandPalette } from '../palette/CommandPalette';
import { ContextPanel } from '../panel/ContextPanel';
import { AlertBanner } from '../reminders/AlertBanner';
import { useServices, useStore } from '../state/use-store';
import { TabPanel } from '../tabs/TabPanel';
import { TabStrip } from '../tabs/TabStrip';
import { TreePane } from '../tree/TreePane';
import { DialogHost } from '../ui/DialogHost';
import { Drawer } from './Drawer';
import { GlobalShortcuts } from './GlobalShortcuts';
import { Header } from './Header';
import { Notices } from './Notices';
import { Rail } from './Rail';
import { Splitter } from './Splitter';

export function Shell() {
  const { layout, ready } = useServices();
  const state = useStore(layout.store);
  const [isReady, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void ready.then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const treeDocked = state.treeMode === 'docked' && state.treeOpen;
  const panelDocked = state.panelMode === 'docked' && state.panelOpen;
  const columns = ['var(--rail-w)', treeDocked ? `${state.treeWidth}px 4px` : '', 'minmax(0, 1fr)', panelDocked ? 'var(--panel-w)' : ''].filter(Boolean).join(' ');

  return (
    <div id="app-shell" className="app-shell" data-ready={isReady ? 'true' : undefined} style={{ gridTemplateColumns: columns } as CSSProperties}>
      <Header />
      <Rail />
      {treeDocked ? (
        <>
          <TreePane />
          <Splitter />
        </>
      ) : null}
      <main className="doc-column">
        <TabStrip />
        <AlertBanner />
        <TabPanel />
        <Notices />
      </main>
      {panelDocked ? <ContextPanel onClose={() => layout.togglePanel()} /> : null}
      {state.treeMode === 'drawer' && state.treeDrawerOpen ? (
        <Drawer side="left" label="Notes" onClose={() => layout.closeDrawers()}>
          <TreePane />
        </Drawer>
      ) : null}
      {state.panelMode === 'drawer' && state.panelDrawerOpen ? (
        <Drawer side="right" label="Details" onClose={() => layout.closeDrawers()}>
          <ContextPanel />
        </Drawer>
      ) : null}
      <DialogHost />
      <CommandPalette />
      <GlobalShortcuts />
    </div>
  );
}
