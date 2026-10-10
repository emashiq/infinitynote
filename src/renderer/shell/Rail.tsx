import { Bell, House, NotebookText, Settings, StickyNote, Waypoints } from 'lucide-react';
import type { ComponentType } from 'react';
import { useServices, useStore } from '../state/use-store';

type RailIcon = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;

export function Rail() {
  const { tabs, layout, commands, ui } = useServices();
  const { session } = useStore(tabs.store);
  useStore(layout.store);
  const active = session.activeTabId;
  const treeVisible = layout.treeVisible();

  const page = (label: string, Icon: RailIcon, tabId: string, command: 'go.home' | 'go.stickies' | 'go.reminders' | 'go.graph' | 'go.settings', extra = '') => (
    <button
      type="button"
      className={`rail-btn ${active === tabId ? 'is-on' : ''} ${extra}`.trim()}
      aria-label={label}
      title={label}
      aria-current={active === tabId ? 'page' : undefined}
      onClick={() => void commands.run(command)}
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden />
    </button>
  );

  return (
    <nav className="rail" aria-label="Primary">
      {page('Home', House, 'home', 'go.home')}
      <button
        type="button"
        className={`rail-btn ${treeVisible ? 'is-on' : ''}`}
        aria-label="Notes"
        title="Notes"
        aria-expanded={treeVisible}
        aria-controls="tree-pane"
        onClick={() => {
          const opening = !layout.treeVisible();
          layout.toggleTree();
          if (opening) ui.requestFocus({ target: 'tree' });
        }}
      >
        <NotebookText size={20} strokeWidth={1.75} aria-hidden />
      </button>
      {page('Stickies', StickyNote, 'page:stickies', 'go.stickies')}
      {page('Reminders', Bell, 'page:reminders', 'go.reminders')}
      {page('Graph', Waypoints, 'page:graph', 'go.graph')}
      {page('Settings', Settings, 'page:settings', 'go.settings', 'rail-bottom')}
    </nav>
  );
}
