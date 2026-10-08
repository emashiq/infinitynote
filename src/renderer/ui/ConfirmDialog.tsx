import { Dialog } from './Dialog';

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
