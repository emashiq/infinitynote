import type { CommandId } from './commands';

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface ShortcutGroup {
  title: string;
  items: ReadonlyArray<{ keys: string; action: string }>;
}

/**
 * Keyboard help (Help → Keyboard shortcuts, Ctrl+/; INF-KEY-06): the application keys matchShortcut maps, then the
 * tree, editor and sticky-window keys (UX_SPEC section 7).
 */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'App',
    items: [
      { keys: 'Ctrl+N', action: 'New note' },
      { keys: 'Ctrl+Shift+N', action: 'New sticky' },
      { keys: 'Ctrl+W', action: 'Close tab' },
      { keys: 'Ctrl+Tab', action: 'Next tab' },
      { keys: 'Ctrl+Shift+Tab', action: 'Previous tab' },
      { keys: 'Ctrl+K', action: 'Search notes and commands' },
      { keys: 'Ctrl+F', action: 'Find in note' },
      { keys: 'Ctrl+\\', action: 'Toggle notes tree' },
      { keys: 'Ctrl+Shift+\\', action: 'Toggle details panel' },
      { keys: 'Ctrl+/', action: 'Keyboard shortcuts' },
      { keys: 'Alt', action: 'Menu bar (File, View, Help)' },
      { keys: 'Escape', action: 'Close menus and dialogs' },
    ],
  },
  {
    title: 'Notes tree',
    items: [
      { keys: 'Arrow keys', action: 'Move, expand and collapse' },
      { keys: 'Enter', action: 'Open' },
      { keys: 'F2', action: 'Rename' },
      { keys: 'Delete', action: 'Move to Trash' },
      { keys: 'Shift+F10', action: 'Item menu' },
    ],
  },
  {
    title: 'Editor',
    items: [
      { keys: 'Ctrl+B', action: 'Bold' },
      { keys: 'Ctrl+I', action: 'Italic' },
      { keys: 'Ctrl+E', action: 'Inline code' },
      { keys: 'Ctrl+Alt+1, 2, 3', action: 'Heading 1, 2, 3' },
      { keys: 'Ctrl+Shift+7', action: 'Numbered list' },
      { keys: 'Ctrl+Shift+8', action: 'Bulleted list' },
      { keys: 'Ctrl+Shift+9', action: 'Checklist' },
      { keys: 'Ctrl+Enter', action: 'Check or uncheck the checklist item' },
      { keys: 'Ctrl+Z', action: 'Undo' },
      { keys: 'Ctrl+Shift+Z, Ctrl+Y', action: 'Redo' },
      { keys: 'Ctrl+Click', action: 'Open a link' },
      { keys: 'Enter, Shift+Enter', action: 'Next, previous match in Find' },
    ],
  },
  {
    title: 'Sticky windows',
    items: [
      { keys: 'Ctrl+W', action: 'Hide the sticky' },
      { keys: 'Ctrl+F', action: 'Find in the sticky' },
    ],
  },
];

/** Maps a key event to an application command, or null when the event is not a shortcut. */
export function matchShortcut(e: KeyLike): CommandId | null {
  if (e.altKey || e.metaKey || !e.ctrlKey) return null;
  if (e.code === 'Backslash') return e.shiftKey ? 'view.togglePanel' : 'view.toggleTree';
  const key = e.key.toLowerCase();
  if (key === 'tab') return e.shiftKey ? 'tab.prev' : 'tab.next';
  if (key === 'n') return e.shiftKey ? 'sticky.new' : 'note.new';
  // "/" is Shift+7 on some layouts, so the character decides; the Slash key without Shift covers the rest.
  if (e.key === '/' || (e.code === 'Slash' && !e.shiftKey)) return 'help.shortcuts';
  if (e.shiftKey) return null;
  if (key === 'w') return 'tab.close';
  if (key === 'k') return 'palette.open';
  if (key === 'f') return 'note.find';
  return null;
}
