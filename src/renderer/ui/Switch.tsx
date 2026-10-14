import { useId, type Ref } from 'react';

/** A labelled on/off switch; a disabled one says why in its tooltip (`title`). */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
  title,
  switchRef,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
  switchRef?: Ref<HTMLButtonElement>;
}) {
  const id = useId();
  return (
    <div className="switch-row" title={title}>
      <span id={id}>{label}</span>
      <button ref={switchRef} type="button" role="switch" aria-checked={checked} aria-labelledby={id} className="switch" disabled={disabled} title={title} onClick={() => onChange(!checked)}>
        <span className="switch-thumb" />
      </button>
    </div>
  );
}
