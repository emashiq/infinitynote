import { INK, type HexColor } from '../../shared/color';
import { StickyColorPreset, type NoteColorType } from '../../shared/contracts/hierarchy';
import { TEXT_COLORS } from '../../shared/editor/formatting';
import { STICKY_COLORS, stickyBackground } from '../../shared/sticky-colors';
import { appliedTheme } from '../theme/theme';
import { ColorPicker } from '../ui/ColorPicker';
import { Popover } from '../ui/Popover';

const TEXT_SWATCHES = [
  { value: INK.dark, label: 'Black', color: INK.dark },
  { value: INK.light, label: 'White', color: INK.light },
  ...TEXT_COLORS.map((c) => ({ value: c.value, label: c.label, color: c.value })),
];

/**
 * The sticky's colors (UX_SPEC section 5): the six presets, shown in the current theme's variant, or any custom color,
 * and the default text color (Automatic picks dark or light ink for the background). A choice applies at once and the
 * popover stays open, so both can be set; Escape or a click elsewhere closes it.
 */
export function ColorMenu({
  color,
  textColor,
  anchor,
  onColor,
  onTextColor,
  onClose,
}: {
  color: NoteColorType;
  textColor: HexColor | null;
  anchor: { x: number; y: number };
  onColor: (color: NoteColorType) => void;
  onTextColor: (color: HexColor | null) => void;
  onClose: () => void;
}) {
  const theme = appliedTheme(document.documentElement);
  const presets = StickyColorPreset.options.map((preset) => ({ value: preset, label: STICKY_COLORS[preset].label, color: stickyBackground(preset, theme) }));
  return (
    <Popover label="Sticky color" anchor={anchor} className="sticky-color-popover" onClose={onClose}>
      <p className="popover-heading" aria-hidden>
        Sticky color
      </p>
      <ColorPicker label="Sticky color" swatches={presets} current={color} onSelect={(value) => value && onColor(value as NoteColorType)} />
      <p className="popover-heading" aria-hidden>
        Text color
      </p>
      <ColorPicker label="Text color" swatches={TEXT_SWATCHES} current={textColor} reset="Automatic" onSelect={(value) => onTextColor(value as HexColor | null)} />
    </Popover>
  );
}
