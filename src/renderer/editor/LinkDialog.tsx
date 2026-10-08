import { useId, useState } from 'react';
import { parseExternalUrl } from '../../shared/url-policy';
import { Dialog } from '../ui/Dialog';
import { LINK_ERROR } from './link';

/**
 * "Link" dialog (UX_SPEC section 6): only http and https addresses are accepted (INF-SEC-01). The editor gets the
 * focus back on close (with the selection the link applies to), not the toolbar button.
 */
export function LinkDialog({
  initial,
  editing,
  onSave,
  onRemove,
  onClose,
}: {
  initial: string;
  editing: boolean;
  onSave: (href: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [address, setAddress] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const save = () => {
    const href = address.trim();
    if (!parseExternalUrl(href).ok) {
      setError(LINK_ERROR);
      return;
    }
    onSave(href);
  };
  return (
    <Dialog title="Link" onClose={onClose} returnFocus={false}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label htmlFor={inputId} className="field-label">
          Address
        </label>
        <input
          id={inputId}
          className="text-input"
          value={address}
          data-autofocus=""
          data-select=""
          onChange={(e) => {
            setAddress(e.target.value);
            setError(null);
          }}
        />
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary">
            Save
          </button>
          {editing ? (
            <button type="button" className="btn" onClick={onRemove}>
              Remove link
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
