import { useEffect, useRef, type ReactNode } from 'react';
import { openModal, useReturnFocus } from '../ui/Dialog';

/** Slide-in drawer on a native modal <dialog>. Mount it only while open; Escape and backdrop clicks close it. */
export function Drawer({ side, label, onClose, children }: { side: 'left' | 'right'; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useReturnFocus();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    openModal(el);
    const target = el.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]') ?? el.querySelector<HTMLElement>('[tabindex="0"], button, input');
    target?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`drawer drawer-${side}`}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
