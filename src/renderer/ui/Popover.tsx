import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * A small non-modal panel at a point (below the button that opened it), kept inside the window. The focus moves into it
 * (to the checked radio, else the first control) and returns to the invoker when it closes; Escape or a press outside
 * closes it, and Tab stays inside it.
 */
export function Popover({
  label,
  anchor,
  className,
  onClose,
  children,
}: {
  label: string;
  anchor: { x: number; y: number };
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.left = `${Math.max(4, Math.min(anchor.x, window.innerWidth - el.offsetWidth - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(anchor.y, window.innerHeight - el.offsetHeight - 4))}px`;
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    (root?.querySelector<HTMLElement>('[aria-checked="true"]') ?? focusables(root)[0])?.focus();
    const onDown = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      if (previous && previous.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables(ref.current);
    const index = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    items[(index + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
  };

  return (
    <div ref={ref} role="dialog" aria-label={label} className={`menu popover ${className ?? ''}`.trim()} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

/** The controls Tab moves between: enabled buttons and fields, one stop per radio group (its tabbable radio). */
function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')].filter((el) => el.tabIndex >= 0);
}
