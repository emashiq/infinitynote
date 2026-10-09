import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { normalizeHexColor, type HexColor } from '../../shared/color';

export interface Swatch {
  /** What is passed back when the swatch is chosen (a preset name or a color). */
  value: string;
  label: string;
  /** The CSS color the swatch shows. */
  color: string;
}

export const CUSTOM_COLOR_ERROR = 'Enter a color as #rrggbb, for example #3366ff.';

/**
 * Preset swatches (a radio group; arrow keys move between them, Enter, Space or a click chooses) plus a custom color:
 * the system color dialog or a hex field. Every custom value is a validated `#rrggbb` before it is passed on.
 */
export function ColorPicker({
  label,
  swatches,
  current,
  reset,
  onSelect,
}: {
  label: string;
  swatches: readonly Swatch[];
  /** The chosen value: a swatch value, a custom `#rrggbb`, or null for the reset choice. */
  current: string | null;
  /** The choice that removes the color ("Default", "None", "Automatic"). */
  reset?: string;
  onSelect: (value: string | null) => void;
}) {
  const custom = swatches.some((s) => s.value === current) ? null : normalizeHexColor(current);
  const [hex, setHex] = useState(custom ?? '');
  const [error, setError] = useState(false);
  const colorRef = useRef<HTMLInputElement>(null);
  const choices: Array<{ value: string | null; label: string; color: string | null }> = [...(reset ? [{ value: null, label: reset, color: null }] : []), ...swatches];
  // The checked swatch is the radio group's tab stop (the first one when a custom color is chosen).
  const checkedIndex = Math.max(0, choices.findIndex((c) => c.value === current));

  // The system color dialog reports its choice with a change event once it closes (React's onChange is "input").
  const selectRef = useRef(onSelect);
  useEffect(() => {
    selectRef.current = onSelect;
  });
  useEffect(() => {
    const input = colorRef.current;
    if (!input) return undefined;
    const onChange = () => {
      const color = normalizeHexColor(input.value);
      if (color) selectRef.current(color);
    };
    input.addEventListener('change', onChange);
    return () => input.removeEventListener('change', onChange);
  }, []);

  const applyHex = () => {
    const color: HexColor | null = normalizeHexColor(hex);
    if (!color) {
      setError(true);
      return;
    }
    onSelect(color);
  };

  const onSwatchKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const radios = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    radios[(radios.indexOf(e.target as HTMLButtonElement) + step + radios.length) % radios.length]?.focus();
  };

  return (
    <div className="color-picker">
      <div role="radiogroup" aria-label={label} className="swatches" onKeyDown={onSwatchKey}>
        {choices.map((choice, i) => (
          <button
            key={choice.value ?? 'reset'}
            type="button"
            role="radio"
            aria-checked={choice.value === current}
            aria-label={choice.label}
            title={choice.label}
            tabIndex={i === checkedIndex ? 0 : -1}
            className={choice.color === null ? 'swatch swatch-reset' : 'swatch'}
            style={choice.color === null ? undefined : { background: choice.color }}
            onClick={() => onSelect(choice.value)}
          />
        ))}
      </div>
      <div className="color-custom">
        <input ref={colorRef} type="color" aria-label={`${label}: pick a custom color`} defaultValue={custom ?? '#808080'} />
        <input
          className="text-input"
          aria-label={`${label}: custom color`}
          placeholder="#rrggbb"
          spellCheck={false}
          maxLength={7}
          value={hex}
          aria-invalid={error || undefined}
          onChange={(e) => {
            setHex(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            applyHex();
          }}
        />
        <button type="button" className="btn btn-small" onClick={applyHex}>
          Apply
        </button>
      </div>
      {error ? (
        <p role="alert" className="field-error">
          {CUSTOM_COLOR_ERROR}
        </p>
      ) : null}
    </div>
  );
}
