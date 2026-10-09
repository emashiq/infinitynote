import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useServices, useStore } from '../state/use-store';
import { Menu, type MenuItem } from '../ui/Menu';

type MenuName = 'File' | 'View' | 'Help';
const MENUS: readonly MenuName[] = ['File', 'View', 'Help'];

/**
 * The in-app menu bar of the main window's title bar (D-097): File, View and Help over the existing commands. Alt
 * alone moves the focus to it; Left and Right move between the menus, Down, Enter or Space opens one, Escape closes it.
 */
export function AppMenuBar() {
  const { commands, layout, theme, reminders, ui, bridge, tabs } = useServices();
  useStore(layout.store);
  const { session } = useStore(tabs.store);
  const noteTabActive = session.tabs.find((t) => t.id === session.activeTabId)?.kind === 'note';
  const themeValue = useStore(theme.store).value;
  const widgetOpen = useStore(reminders.store).widget.open;
  const [open, setOpen] = useState<{ name: MenuName; anchor: { x: number; y: number } } | null>(null);
  const buttons = useRef<Partial<Record<MenuName, HTMLButtonElement | null>>>({});

  // Alt pressed and released on its own focuses the menu bar, as a native menu bar does.
  useEffect(() => {
    let altAlone = false;
    const onDown = (e: globalThis.KeyboardEvent) => {
      altAlone = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey;
    };
    const onUp = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Alt' || !altAlone) return;
      altAlone = false;
      e.preventDefault();
      buttons.current.File?.focus();
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, []);

  const show = (name: MenuName) => {
    const r = buttons.current[name]!.getBoundingClientRect();
    setOpen({ name, anchor: { x: r.left, y: r.bottom + 2 } });
  };
  const run = (id: Parameters<typeof commands.run>[0]) => () => void commands.run(id);
  const items: Record<MenuName, MenuItem[]> = {
    File: [
      { id: 'new-note', label: 'New note', shortcut: 'Ctrl+N', onSelect: run('note.new') },
      { id: 'new-sticky', label: 'New sticky', shortcut: 'Ctrl+Shift+N', onSelect: run('sticky.new') },
      { id: 'close-tab', label: 'Close tab', shortcut: 'Ctrl+W', onSelect: run('tab.close') },
      { id: 'export-markdown', label: 'Export note as Markdown…', separatorBefore: true, disabled: !noteTabActive, onSelect: run('note.exportMarkdown') },
      { id: 'export-text', label: 'Export note as plain text…', disabled: !noteTabActive, onSelect: run('note.exportText') },
      { id: 'export-all', label: 'Export all notes…', onSelect: run('notes.exportAll') },
      { id: 'import', label: 'Import notes…', onSelect: run('notes.import') },
      { id: 'backup', label: 'Back up now…', separatorBefore: true, onSelect: run('backup.create') },
      { id: 'restore', label: 'Restore from backup…', onSelect: run('backup.restore') },
      { id: 'quit', label: 'Quit Infinity Notes', separatorBefore: true, onSelect: () => void bridge.app.quit() },
    ],
    View: [
      ...(['light', 'dark', 'system'] as const).map((value) => ({
        id: `theme-${value}`,
        label: `${value[0]!.toUpperCase()}${value.slice(1)} theme`,
        radio: true,
        checked: themeValue === value,
        onSelect: () => void theme.set(value),
      })),
      { id: 'tree', label: 'Toggle notes tree', shortcut: 'Ctrl+\\', separatorBefore: true, onSelect: run('view.toggleTree') },
      { id: 'panel', label: 'Toggle details panel', shortcut: 'Ctrl+Shift+\\', onSelect: run('view.togglePanel') },
      { id: 'widget', label: widgetOpen ? 'Hide reminder widget' : 'Show reminder widget', separatorBefore: true, onSelect: () => void reminders.setWidgetOpen(!widgetOpen) },
    ],
    Help: [
      { id: 'shortcuts', label: 'Keyboard shortcuts', shortcut: 'Ctrl+/', onSelect: run('help.shortcuts') },
      { id: 'about', label: 'About Infinity Notes', onSelect: () => ui.openDialog({ kind: 'about' }) },
    ],
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, name: MenuName) => {
    const i = MENUS.indexOf(name);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step !== 0) {
      e.preventDefault();
      buttons.current[MENUS[(i + step + MENUS.length) % MENUS.length]!]?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      show(name);
    } else if (e.key === 'Escape') {
      (e.currentTarget as HTMLElement).blur();
    }
  };

  return (
    <div className="menubar" role="menubar" aria-label="Application menu">
      {MENUS.map((name) => (
        <button
          key={name}
          ref={(el) => {
            buttons.current[name] = el;
          }}
          type="button"
          role="menuitem"
          className="menubar-item"
          aria-haspopup="menu"
          aria-expanded={open?.name === name}
          onClick={() => (open?.name === name ? setOpen(null) : show(name))}
          onKeyDown={(e) => onKeyDown(e, name)}
        >
          {name}
        </button>
      ))}
      {open ? <Menu label={open.name} anchor={open.anchor} items={items[open.name]} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
