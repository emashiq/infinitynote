import type { CommandId } from './commands';

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** The keyboard shortcuts of the main window, as Help → Keyboard shortcuts lists them (the keys matchShortcut maps). */
export const SHORTCUT_LIST: ReadonlyArray<{ keys: string; action: string }> = [
  { keys: 'Ctrl+N', action: 'New note' },
  { keys: 'Ctrl+Shift+N', action: 'New sticky' },
  { keys: 'Ctrl+W', action: 'Close tab' },
  { keys: 'Ctrl+Tab', action: 'Next tab' },
  { keys: 'Ctrl+Shift+Tab', action: 'Previous tab' },
  { keys: 'Ctrl+K', action: 'Search notes and commands' },
  { keys: 'Ctrl+F', action: 'Find in note' },
  { keys: 'Ctrl+\\', action: 'Toggle notes tree' },
  { keys: 'Ctrl+Shift+\\', action: 'Toggle details panel' },
  { keys: 'Alt', action: 'Menu bar (File, View, Help)' },
];

/** Maps a key event to an application command, or null when the event is not a shortcut. */
export function matchShortcut(e: KeyLike): CommandId | null {
  if (e.altKey || e.metaKey || !e.ctrlKey) return null;
  if (e.code === 'Backslash') return e.shiftKey ? 'view.togglePanel' : 'view.toggleTree';
  const key = e.key.toLowerCase();
  if (key === 'tab') return e.shiftKey ? 'tab.prev' : 'tab.next';
  if (key === 'n') return e.shiftKey ? 'sticky.new' : 'note.new';
  if (e.shiftKey) return null;
  if (key === 'w') return 'tab.close';
  if (key === 'k') return 'palette.open';
  if (key === 'f') return 'note.find';
  return null;
}
