import { Fragment, useEffect, useRef, type KeyboardEvent } from 'react';

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  checked?: boolean;
  /** Draws a separator line above this item. */
  separatorBefore?: boolean;
  onSelect: () => void;
}

/** Popover menu positioned at a point. Focus goes to the first enabled item and returns to the invoker on close. */
export function Menu({
  items,
  anchor,
  label,
  itemRole = 'menuitem',
  onClose,
}: {
  items: MenuItem[];
  anchor: { x: number; y: number };
  label: string;
  itemRole?: 'menuitem' | 'menuitemradio';
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const buttons = root ? [...root.querySelectorAll<HTMLButtonElement>('button:not([disabled])')] : [];
    (buttons.find((b) => b.getAttribute('aria-checked') === 'true') ?? buttons[0])?.focus();
    const onDown = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      if (previous && previous.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const root = ref.current;
    if (!root) return;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number) => buttons[(i + buttons.length) % buttons.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(index <= 0 ? buttons.length - 1 : index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(buttons.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      case 'Tab':
        e.preventDefault();
        onClose();
        break;
      default:
    }
  };

  const vw = typeof window === 'undefined' ? 1000 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const left = Math.max(4, Math.min(anchor.x, vw - 224));
  const top = Math.max(4, Math.min(anchor.y, vh - items.length * 30 - 16));

  return (
    <div ref={ref} role="menu" aria-label={label} className="menu" style={{ left, top }} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.separatorBefore ? <div role="separator" className="menu-separator" /> : null}
          <button
            type="button"
            role={itemRole}
            aria-checked={itemRole === 'menuitemradio' ? !!item.checked : undefined}
            disabled={item.disabled}
            tabIndex={-1}
            className="menu-item"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
