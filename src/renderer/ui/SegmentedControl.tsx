export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

/** Segmented toggle built on native radio inputs: arrow keys move and select, Space selects. */
export function SegmentedControl<T extends string>({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map((o) => (
        <label key={o.value} className={`segment ${value === o.value ? 'is-on' : ''} ${o.disabled ? 'is-disabled' : ''}`} title={o.title}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            aria-disabled={o.disabled ? true : undefined}
            onChange={() => {
              if (!o.disabled) onChange(o.value);
            }}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
