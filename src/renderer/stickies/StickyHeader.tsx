import { ChevronDown, ChevronUp, Ellipsis, Pin, X } from 'lucide-react';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import type { NoteColorType } from '../../shared/contracts/hierarchy';
import { STICKY_MESSAGES, type StickyStateType } from '../../shared/contracts/stickies';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { ColorMenu } from './ColorMenu';

export const STICKY_MENU_LABELS = {
  openInApp: 'Open in app',
  changeColor: 'Change color',
  hide: 'Hide',
  remove: 'Remove from stickies',
  trash: 'Move to Trash',
  quit: 'Quit Infinity Notes',
} as const;

export interface StickyHeaderActions {
  setColor(color: NoteColorType): void;
  togglePinned(): void;
  toggleCollapsed(): void;
  openInApp(): void;
  hide(): void;
  remove(): void;
  /** Asks to move the note to Trash (the caller confirms first). */
  trash(): void;
  quit(): void;
}

type OpenMenu = { kind: 'color' | 'actions'; anchor: { x: number; y: number } } | null;

/** The point just below a button, read when the menu opens. */
const below = (ref: RefObject<HTMLButtonElement | null>) => {
  const rect = ref.current?.getBoundingClientRect();
  return { x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 2 };
};

/**
 * The 36 px sticky header (D-070): color, title, source badge, pin (disabled where always-on-top is unsupported),
 * collapse, the actions menu and Close. The window is frameless (D-097): the header is its title bar and drag region;
 * its controls are not. Close hides the sticky, as closing its window always has.
 */
export function StickyHeader({
  state,
  pinSupported,
  trashed,
  titleField,
  actions,
}: {
  state: StickyStateType;
  pinSupported: boolean;
  trashed: boolean;
  titleField: ReactNode;
  actions: StickyHeaderActions;
}) {
  const [menu, setMenu] = useState<OpenMenu>(null);
  const colorRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<HTMLButtonElement>(null);
  const path = state.path.join(' › ');
  const close = () => setMenu(null);
  const openColors = () => setMenu({ kind: 'color', anchor: below(colorRef) });
  const items = [
    { id: 'open', label: STICKY_MENU_LABELS.openInApp, onSelect: actions.openInApp },
    { id: 'color', label: STICKY_MENU_LABELS.changeColor, onSelect: openColors },
    { id: 'hide', label: STICKY_MENU_LABELS.hide, onSelect: actions.hide },
    { id: 'remove', label: STICKY_MENU_LABELS.remove, onSelect: actions.remove, disabled: trashed },
    { id: 'trash', label: STICKY_MENU_LABELS.trash, onSelect: actions.trash, disabled: trashed },
    { id: 'quit', label: STICKY_MENU_LABELS.quit, onSelect: actions.quit, separatorBefore: true },
  ];
  return (
    <div className="sticky-header" role="toolbar" aria-label="Sticky">
      <button
        ref={colorRef}
        type="button"
        className="icon-btn sticky-color-btn"
        aria-label="Sticky color"
        title="Sticky color"
        aria-haspopup="menu"
        aria-expanded={menu?.kind === 'color'}
        onClick={openColors}
      >
        <span className={`dot dot-${state.color}`} aria-hidden />
      </button>
      {titleField}
      <span className="sticky-badge" title={path}>
        {path}
      </span>
      <IconButton
        label="Keep on top"
        icon={Pin}
        size={14}
        className="sticky-pin"
        aria-pressed={state.alwaysOnTop}
        aria-disabled={pinSupported ? undefined : true}
        title={pinSupported ? 'Keep on top' : STICKY_MESSAGES.unsupported}
        onClick={() => {
          if (pinSupported) actions.togglePinned();
        }}
      />
      <IconButton
        label={state.collapsed ? 'Expand sticky' : 'Collapse sticky'}
        icon={state.collapsed ? ChevronDown : ChevronUp}
        size={14}
        aria-expanded={!state.collapsed}
        onClick={actions.toggleCollapsed}
      />
      <IconButton
        label="Sticky actions"
        icon={Ellipsis}
        size={14}
        buttonRef={actionsRef}
        aria-haspopup="menu"
        aria-expanded={menu?.kind === 'actions'}
        onClick={() => setMenu({ kind: 'actions', anchor: below(actionsRef) })}
      />
      <IconButton label="Close sticky" title="Close (Ctrl+W)" icon={X} size={14} className="sticky-close" onClick={actions.hide} />
      {menu?.kind === 'actions' ? <Menu label="Sticky actions" anchor={menu.anchor} items={items} onClose={close} /> : null}
      {menu?.kind === 'color' ? <ColorMenu current={state.color} anchor={menu.anchor} onSelect={actions.setColor} onClose={close} /> : null}
    </div>
  );
}
