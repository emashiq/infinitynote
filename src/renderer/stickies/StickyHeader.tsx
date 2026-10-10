import { ChevronDown, ChevronUp, Ellipsis, Lock, Pin, X } from 'lucide-react';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import type { HexColor } from '../../shared/color';
import type { NoteColorType } from '../../shared/contracts/hierarchy';
import { STICKY_MESSAGES, type StickyStateType } from '../../shared/contracts/stickies';
import { ColorDot } from '../ui/ColorDot';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { ColorMenu } from './ColorMenu';

export const STICKY_MENU_LABELS = {
  openInApp: 'Open in app',
  rename: 'Rename',
  changeColor: 'Change color',
  hide: 'Hide',
  remove: 'Remove from stickies',
  trash: 'Move to Trash',
  quit: 'Quit Infinity Notes',
  blur: 'Blur now',
  setPin: 'Set PIN…',
  changePin: 'Change PIN…',
} as const;

/** The lock part of the menu of a locked note's sticky (D-172, D-173). */
export interface StickyHeaderLock {
  revealed: boolean;
  pinSet: boolean;
  blur(): void;
  editPin(): void;
}

export interface StickyHeaderActions {
  setColor(color: NoteColorType): void;
  /** The default text color; null is Automatic. */
  setTextColor(color: HexColor | null): void;
  togglePinned(): void;
  toggleCollapsed(): void;
  openInApp(): void;
  /** Moves into the title field with the title selected (also F2 in the sticky). */
  rename(): void;
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
 * collapse, the actions menu and Close. The title and the source badge share one center line; the badge shrinks first
 * and ends with an ellipsis (its tooltip has the whole path). The window is frameless (D-097): the header is the title bar and drag region,
 * gaps, empty space and source badge included; only the small controls and the title field, which is as wide as its
 * text, are not (D-102). A click on the title edits it in place; Rename in the actions menu and F2 select it.
 * Close hides the sticky, as closing its window always has.
 */
export function StickyHeader({
  state,
  pinSupported,
  trashed,
  canRename,
  titleField,
  actions,
  lock,
}: {
  state: StickyStateType;
  pinSupported: boolean;
  trashed: boolean;
  canRename: boolean;
  titleField: ReactNode;
  actions: StickyHeaderActions;
  /** Present while the note is locked. */
  lock?: StickyHeaderLock;
}) {
  const [menu, setMenu] = useState<OpenMenu>(null);
  const colorRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<HTMLButtonElement>(null);
  const path = state.path.join(' › ');
  const close = () => setMenu(null);
  const openColors = () => setMenu({ kind: 'color', anchor: below(colorRef) });
  const items = [
    { id: 'open', label: STICKY_MENU_LABELS.openInApp, onSelect: actions.openInApp },
    { id: 'rename', label: STICKY_MENU_LABELS.rename, onSelect: actions.rename, disabled: !canRename },
    { id: 'color', label: STICKY_MENU_LABELS.changeColor, onSelect: openColors },
    { id: 'hide', label: STICKY_MENU_LABELS.hide, onSelect: actions.hide },
    { id: 'remove', label: STICKY_MENU_LABELS.remove, onSelect: actions.remove, disabled: trashed },
    { id: 'trash', label: STICKY_MENU_LABELS.trash, onSelect: actions.trash, disabled: trashed },
    ...(lock
      ? [
          { id: 'blur', label: STICKY_MENU_LABELS.blur, onSelect: lock.blur, disabled: !lock.revealed, separatorBefore: true },
          { id: 'pin', label: lock.pinSet ? STICKY_MENU_LABELS.changePin : STICKY_MENU_LABELS.setPin, onSelect: lock.editPin },
        ]
      : []),
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
        aria-haspopup="dialog"
        aria-expanded={menu?.kind === 'color'}
        onClick={openColors}
      >
        <ColorDot color={state.color} />
      </button>
      <span className="sticky-heading">
        {lock ? <Lock size={12} strokeWidth={2} className="sticky-lock-icon" aria-label="Locked" /> : null}
        {titleField}
        <span className="sticky-badge" title={path}>
          {path}
        </span>
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
      {menu?.kind === 'color' ? (
        <ColorMenu color={state.color} textColor={state.textColor} anchor={menu.anchor} onColor={actions.setColor} onTextColor={actions.setTextColor} onClose={close} />
      ) : null}
    </div>
  );
}
