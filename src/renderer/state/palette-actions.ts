import type { CommandId } from './commands';

export interface PaletteAction {
  id: CommandId;
  label: string;
  shortcut?: string;
}

export const PALETTE_ACTIONS: PaletteAction[] = [
  { id: 'note.new', label: 'New note', shortcut: 'Ctrl+N' },
  { id: 'note.newPlain', label: 'New plain-text note' },
  { id: 'sticky.new', label: 'New sticky', shortcut: 'Ctrl+Shift+N' },
  { id: 'project.new', label: 'New project' },
  { id: 'folder.new', label: 'New folder' },
  { id: 'go.home', label: 'Go to Home' },
  { id: 'go.stickies', label: 'Open Stickies' },
  { id: 'go.reminders', label: 'Open Reminders' },
  { id: 'go.settings', label: 'Open Settings' },
  { id: 'view.toggleTree', label: 'Toggle notes tree', shortcut: 'Ctrl+\\' },
  { id: 'view.togglePanel', label: 'Toggle details panel', shortcut: 'Ctrl+Shift+\\' },
  { id: 'tab.close', label: 'Close tab', shortcut: 'Ctrl+W' },
  { id: 'tab.next', label: 'Next tab', shortcut: 'Ctrl+Tab' },
  { id: 'tab.prev', label: 'Previous tab', shortcut: 'Ctrl+Shift+Tab' },
  { id: 'note.find', label: 'Find in note', shortcut: 'Ctrl+F' },
  { id: 'note.insertReference', label: 'Link to note…' },
  { id: 'note.float', label: 'Float current note' },
  { id: 'note.exportMarkdown', label: 'Export note as Markdown…' },
  { id: 'backup.create', label: 'Back up now…' },
  { id: 'help.shortcuts', label: 'Keyboard shortcuts', shortcut: 'Ctrl+/' },
];

/** Case-insensitive substring or word-prefix match; keeps list order. An empty query returns everything. */
export function filterActions(actions: readonly PaletteAction[], query: string): PaletteAction[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...actions];
  const tokens = q.split(/\s+/);
  return actions.filter((a) => {
    const label = a.label.toLowerCase();
    if (label.includes(q)) return true;
    const words = label.split(/\s+/);
    return tokens.every((t) => words.some((w) => w.startsWith(t)));
  });
}
