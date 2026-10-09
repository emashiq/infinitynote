import { useId, useState, type ReactNode } from 'react';

/** One Settings section: a labelled region with its heading, so screen readers can jump between sections. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="settings-section" aria-labelledby={id}>
      <h3 className="section-label" id={id}>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <select id={id} className="select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input id={id} type="time" className="text-input" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </div>
  );
}

/**
 * A whole number within bounds. It is saved when it loses focus or on Enter; an out-of-range entry shows the allowed
 * range and is not saved.
 */
export function NumberField({ label, value, min, max, unit, onCommit }: { label: string; value: number; min: number; max: number; unit: string; onCommit: (v: number) => void }) {
  const id = useId();
  const errorId = useId();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  // A change from elsewhere (another window, a refused write) replaces the draft.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }
  const commit = () => {
    const n = Number(draft);
    if (!Number.isInteger(n) || n < min || n > max) {
      setError(`Enter a whole number from ${min} to ${max}.`);
      return;
    }
    setError(null);
    if (n !== value) onCommit(n);
  };
  return (
    <div className="form-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <span className="inline-unit">
        <input
          id={id}
          type="number"
          className="text-input number-input"
          min={min}
          max={max}
          step={1}
          value={draft}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
        <span>{unit}</span>
      </span>
      {error ? (
        <p id={errorId} role="alert" className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
