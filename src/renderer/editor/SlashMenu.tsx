import { posToDOMRect, type Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { filterActions } from '../state/palette-actions';
import { Floating } from './Floating';
import type { InsertItem } from './note-actions';
import { slashMatch } from './slash-menu';

/**
 * The insert menu of a rich note (D-102): typing "/" at the start of a line or after a space lists the entries
 * matching the letters typed after it. Up and Down choose, Enter or Tab runs the entry in place of the typed command,
 * Escape leaves the text as typed. The focus stays in the text; the editor routes those keys here (`onKeyDown`).
 */
export function useSlashMenu(editor: Editor, items: readonly InsertItem[], enabled: boolean): { element: ReactNode; onKeyDown(event: KeyboardEvent): boolean } {
  const match = useEditorState({ editor, selector: ({ editor: e }) => (enabled && e.isFocused ? slashMatch(e.state) : null) });
  const listId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Escape hides the menu for that "/" until the command is gone.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  if (match === null && dismissedAt !== null) setDismissedAt(null);
  const [active, setActive] = useState<{ query: string | null; index: number }>({ query: null, index: 0 });
  const query = match?.query ?? null;
  if (active.query !== query) setActive({ query, index: 0 });

  const shown = match && match.from !== dismissedAt ? filterActions(items, match.query) : [];
  const open = match !== null && shown.length > 0;
  const index = Math.min(active.index, Math.max(0, shown.length - 1));
  const activeId = open ? `${listId}-${shown[index]!.id}` : null;

  // Screen readers follow the active entry from the text field.
  useEffect(() => {
    if (!activeId) return undefined;
    const dom = editor.view.dom;
    dom.setAttribute('aria-controls', listId);
    dom.setAttribute('aria-activedescendant', activeId);
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    return () => {
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-activedescendant');
    };
  }, [editor, listId, activeId]);

  const pick = (item: InsertItem) => {
    if (!match) return;
    editor.chain().focus().deleteRange({ from: match.from, to: match.to }).run();
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (!open || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return false;
    switch (event.key) {
      case 'ArrowDown':
        setActive({ query, index: (index + 1) % shown.length });
        return true;
      case 'ArrowUp':
        setActive({ query, index: (index - 1 + shown.length) % shown.length });
        return true;
      case 'Enter':
      case 'Tab':
        pick(shown[index]!);
        return true;
      case 'Escape':
        setDismissedAt(match.from);
        return true;
      default:
        return false;
    }
  };

  const element = open ? (
    <Floating
      elementRef={ref}
      anchor={() => posToDOMRect(editor.view, match.from, match.to)}
      side="below"
      align="start"
      className="slash-menu"
      id={listId}
      role="listbox"
      aria-label="Insert"
    >
      {shown.map((item, i) => (
        <div
          key={item.id}
          id={`${listId}-${item.id}`}
          role="option"
          aria-selected={i === index}
          className="slash-item"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => pick(item)}
        >
          {item.label}
        </div>
      ))}
    </Floating>
  ) : null;

  return { element, onKeyDown };
}
