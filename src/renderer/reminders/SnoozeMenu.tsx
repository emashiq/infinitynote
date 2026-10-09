import { useRef, useState } from 'react';
import type { SnoozePresetType } from '../../shared/contracts/reminders';
import { SNOOZE_LABELS, SNOOZE_PRESETS } from '../../shared/time/snooze';
import { Menu } from '../ui/Menu';

/** "Snooze" with its presets: 5, 10, 15, 30 minutes, 1 hour and Tomorrow 09:00 (D-078). Escape closes the menu. */
export function SnoozeButton({ onSnooze, className = 'btn btn-small' }: { onSnooze: (preset: SnoozePresetType) => void; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => {
          const r = ref.current!.getBoundingClientRect();
          setAnchor({ x: r.left, y: r.bottom + 2 });
        }}
      >
        Snooze
      </button>
      {anchor ? (
        <Menu
          label="Snooze"
          anchor={anchor}
          items={SNOOZE_PRESETS.map((preset) => ({ id: String(preset), label: SNOOZE_LABELS[preset], onSelect: () => onSnooze(preset) }))}
          onClose={() => setAnchor(null)}
        />
      ) : null}
    </>
  );
}
