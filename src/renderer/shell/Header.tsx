import { Infinity as InfinityIcon, PanelLeft, PanelRight, Search } from 'lucide-react';
import { useServices, useStore } from '../state/use-store';
import { IconButton } from '../ui/IconButton';

export function Header() {
  const { commands, layout } = useServices();
  useStore(layout.store);
  return (
    <header role="banner" className="app-header">
      <div className="brand">
        <InfinityIcon size={18} strokeWidth={1.75} className="brand-icon" aria-hidden />
        <h1 className="app-title">Infinity Notes</h1>
      </div>
      <button type="button" className="search-box" aria-label="Search notes and commands (Ctrl+K)" onClick={() => void commands.run('palette.open')}>
        <Search size={14} strokeWidth={1.75} aria-hidden />
        <span className="search-text">Search notes and commands</span>
        <span className="kbds" aria-hidden>
          <kbd>Ctrl</kbd>
          <kbd>K</kbd>
        </span>
      </button>
      <div className="header-actions">
        <IconButton
          label="Toggle notes tree (Ctrl+\)"
          icon={PanelLeft}
          size={18}
          aria-expanded={layout.treeVisible()}
          aria-controls="tree-pane"
          onClick={() => void commands.run('view.toggleTree')}
        />
        <IconButton
          label="Toggle details panel (Ctrl+Shift+\)"
          icon={PanelRight}
          size={18}
          aria-expanded={layout.panelVisible()}
          aria-controls="context-panel"
          onClick={() => void commands.run('view.togglePanel')}
        />
      </div>
    </header>
  );
}
