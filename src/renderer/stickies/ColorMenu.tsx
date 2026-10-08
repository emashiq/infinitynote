import { NoteColor, type NoteColorType } from '../../shared/contracts/hierarchy';
import { STICKY_COLORS } from '../../shared/sticky-colors';
import { Menu } from '../ui/Menu';

/** The six sticky colors as radio menu items, the current one checked (UX_SPEC section 5). */
export function ColorMenu({
  current,
  anchor,
  onSelect,
  onClose,
}: {
  current: NoteColorType;
  anchor: { x: number; y: number };
  onSelect: (color: NoteColorType) => void;
  onClose: () => void;
}) {
  return (
    <Menu
      label="Sticky color"
      itemRole="menuitemradio"
      anchor={anchor}
      onClose={onClose}
      items={NoteColor.options.map((color) => ({
        id: color,
        label: STICKY_COLORS[color].label,
        checked: color === current,
        onSelect: () => onSelect(color),
      }))}
    />
  );
}
