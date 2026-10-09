import { PanelLeft, PanelRight, Search } from 'lucide-react';
import { useServices, useStore } from '../state/use-store';
import { AppLogo } from '../ui/AppLogo';
import { IconButton } from '../ui/IconButton';
import { AppMenuBar } from './AppMenuBar';

/**
 * The main window's only title bar (D-097): the app logo (D-109) and name, the File, View and Help menus, the centered search box
 * and the panel toggles. The bar is the window's drag region; its controls are not. The OS draws minimize, maximize
 * and close over its right end (titleBarOverlay), so the bar leaves that area free.
 */
export function Header() {
  const { commands, layout } = useServices();
  useStore(layout.store);
  return (
    <header role="banner" className="app-header">
      <div className="header-start">
        <div className="brand">
          <AppLogo size={18} className="brand-icon" />
          <h1 className="app-title">Infinity Notes</h1>
        </div>
        <AppMenuBar />
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
