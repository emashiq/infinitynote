import { useState } from 'react';
import type { Outcome } from '../state/store';
import { Dialog } from './Dialog';

/** The "Move to Trash?" confirmation used by the tree and sticky windows (UX_SPEC section 6). */
export const TRASH_CONFIRM = {
  title: 'Move to Trash?',
  confirmLabel: 'Move to Trash',
  body: (label: string) => `“${label}” will be moved to Trash. You can restore it from Trash.`,
} as const;

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  confirmFirst,
  onConfirm,
  onClose,
  error,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  /** True when the confirm button takes initial focus; destructive purges focus Cancel instead. */
  confirmFirst: boolean;
  onConfirm: () => void;
  onClose: () => void;
  error?: string | null;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="dialog-body">{body}</p>
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" data-autofocus={confirmFirst ? '' : undefined} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="btn" data-autofocus={confirmFirst ? undefined : ''} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

/** A confirmation that runs an action and stays open with the error when it fails. */
export function ConfirmRunner({
  title,
  body,
  confirmLabel,
  confirmFirst,
  run,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  confirmFirst: boolean;
  run: () => Promise<Outcome<unknown>>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      title={title}
      body={body}
      confirmLabel={confirmLabel}
      confirmFirst={confirmFirst}
      error={error}
      onClose={onClose}
      onConfirm={() => {
        void run().then((res) => {
          if (res.ok) onClose();
          else setError(res.message);
        });
      }}
    />
  );
}
