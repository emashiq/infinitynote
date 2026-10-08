import { useId } from 'react';

export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  const id = useId();
  return (
    <div className="switch-row">
      <span id={id}>{label}</span>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} className="switch" onClick={() => onChange(!checked)}>
        <span className="switch-thumb" />
      </button>
    </div>
  );
}
