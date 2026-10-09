import { StickyColorPreset, type NoteColorType, type StickyColorPresetType } from './contracts/hierarchy';

/** Sticky background colors of the presets for each theme (UX_SPEC section 10). */
export const STICKY_COLORS: Readonly<Record<StickyColorPresetType, { light: string; dark: string; label: string }>> = {
  yellow: { light: '#FFF4B8', dark: '#4A4320', label: 'Yellow' },
  green: { light: '#DDF5D8', dark: '#24402A', label: 'Green' },
  blue: { light: '#DCEBFF', dark: '#22344F', label: 'Blue' },
  pink: { light: '#FFE0EC', dark: '#4A2634', label: 'Pink' },
  violet: { light: '#ECE6FF', dark: '#342C52', label: 'Violet' },
  gray: { light: '#ECEDF1', dark: '#2E3038', label: 'Gray' },
};

export const DEFAULT_STICKY_COLOR: StickyColorPresetType = 'yellow';

export function isPresetColor(color: NoteColorType): color is StickyColorPresetType {
  return StickyColorPreset.safeParse(color).success;
}

/** The background a sticky shows: a preset's variant for the theme, or a custom color as chosen. */
export function stickyBackground(color: NoteColorType, theme: 'light' | 'dark'): string {
  return isPresetColor(color) ? STICKY_COLORS[color][theme] : color;
}
