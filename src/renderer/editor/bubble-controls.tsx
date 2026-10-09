import { ChevronDown } from 'lucide-react';
import { useRef, useState, type ComponentType } from 'react';
import { ColorPicker, type Swatch } from '../ui/ColorPicker';
import { Menu, type MenuItem } from '../ui/Menu';
import { Popover } from '../ui/Popover';

type Icon = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;

/** The point below a button, where its menu or popover opens. */
const below = (button: HTMLButtonElement | null) => {
  const r = button?.getBoundingClientRect();
  return { x: r?.left ?? 0, y: (r?.bottom ?? 0) + 4 };
};

/** A toolbar button that opens a menu below itself (Heading, Font, Size, Table). */
export function MenuButton({ label, title, icon: IconView, items, itemRole }: { label: string; title?: string; icon: Icon; items: MenuItem[]; itemRole?: 'menuitemradio' }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="icon-btn bubble-menu-btn"
        aria-label={label}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => setAnchor(below(ref.current))}
      >
        <IconView size={16} strokeWidth={1.75} aria-hidden />
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
      </button>
      {anchor ? <Menu items={items} anchor={anchor} label={label} itemRole={itemRole} onClose={() => setAnchor(null)} /> : null}
    </>
  );
}

/**
 * A toolbar button that opens a color popover (Text color, Highlight); a bar under its icon shows the current color.
 * `onOpenChange` lets the toolbar stay up while the popover (or the system color dialog it opens) has the focus.
 */
export function ColorButton({
  label,
  icon: IconView,
  swatches,
  current,
  reset,
  onSelect,
  onOpenChange,
}: {
  label: string;
  icon: Icon;
  swatches: readonly Swatch[];
  current: string | null;
  reset: string;
  onSelect: (color: string | null) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const show = (next: { x: number; y: number } | null) => {
    setAnchor(next);
    onOpenChange(next !== null);
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="icon-btn bubble-color-btn"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={() => show(below(ref.current))}
      >
        <IconView size={16} strokeWidth={1.75} aria-hidden />
        <span className="color-bar" style={current ? { background: current } : undefined} aria-hidden />
      </button>
      {anchor ? (
        <Popover label={label} anchor={anchor} onClose={() => show(null)}>
          <ColorPicker
            label={label}
            swatches={swatches}
            current={current}
            reset={reset}
            onSelect={(color) => {
              show(null);
              onSelect(color);
            }}
          />
        </Popover>
      ) : null}
    </>
  );
}
