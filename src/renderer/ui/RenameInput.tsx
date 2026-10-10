import { useRef, useState } from 'react';

/**
 * An inline name field (tree rows, document tabs, the document header): it opens focused with the name selected,
 * commits on Enter and blur, and cancels on Escape. `onCommit` resolves to an error message, which keeps the field open
 * and shows the message (inline, or through `onError` where there is no room for it), or to null once the name is saved
 * (or did not change).
 */
export function RenameInput({
  initial,
  onCommit,
  onCancel,
  onError,
  label = 'Rename',
  className = 'rename-input',
}: {
  initial: string;
  /** `how` tells Enter (the focus stays with the field's owner) from a blur (the focus went elsewhere). */
  onCommit: (value: string, how: 'enter' | 'blur') => Promise<string | null>;
  onCancel: () => void;
  /** Shows an error elsewhere (a tab has no room under it); the field is still marked invalid. */
  onError?: (message: string) => void;
  label?: string;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // Finished (committed or canceled), and a commit under way: a blur during an Enter commit adds nothing.
  const done = useRef(false);
  const committing = useRef(false);
  const commit = async (how: 'enter' | 'blur') => {
    if (done.current || committing.current) return;
    committing.current = true;
    try {
      const message = await onCommit(value, how);
      if (message) {
        setError(message);
        onError?.(message);
      } else done.current = true;
    } finally {
      committing.current = false;
    }
  };
  return (
    <>
      <input
        className={className}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={value}
        autoFocus
        ref={(el) => {
          if (el && !el.dataset.selected) {
            el.dataset.selected = '1';
            el.focus();
            el.select();
          }
        }}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit('enter');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
        onBlur={() => void commit('blur')}
      />
      {error && !onError ? (
        <span role="alert" className="rename-error">
          {error}
        </span>
      ) : null}
    </>
  );
}
