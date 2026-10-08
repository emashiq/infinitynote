import { useId, useState, type FormEvent } from 'react';
import { normalizeName, validateName } from '../../shared/names';
import { Dialog } from './Dialog';

export function NameDialog({
  title,
  initial,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: string;
  submitLabel: string;
  /** Resolves to an error message, or null on success. */
  onSubmit: (name: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const message = validateName(normalizeName(value));
    if (message) {
      setError(message);
      return;
    }
    setBusy(true);
    const failure = await onSubmit(value);
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <label htmlFor={inputId} className="field-label">
          Name
        </label>
        <input id={inputId} className="text-input" value={value} data-autofocus="" data-select="" onChange={(e) => setValue(e.target.value)} />
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {submitLabel}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
