import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Opens a native <dialog> modally; jsdom lacks showModal, so fall back to the open attribute. */
export function openModal(el: HTMLDialogElement): void {
  if (el.open) return;
  if (typeof el.showModal === 'function') el.showModal();
  else el.setAttribute('open', '');
}

/** Captures the focused element at mount and restores it on unmount when it is still attached. */
export function useReturnFocus(enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
    };
  }, [enabled]);
}

export function focusInitial(root: HTMLElement): void {
  const target = root.querySelector<HTMLElement>('[data-autofocus]') ?? root.querySelector<HTMLElement>('input, button, [tabindex="0"]');
  target?.focus();
  if (target instanceof HTMLInputElement && target.hasAttribute('data-select')) target.select();
}

export function Dialog({
  title,
  onClose,
  children,
  className,
  returnFocus = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** False when the caller moves the focus itself on close (for example back into the editor). */
  returnFocus?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useReturnFocus(returnFocus);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    openModal(el);
    focusInitial(el);
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className ?? ''}`.trim()}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
