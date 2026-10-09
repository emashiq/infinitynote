import { normalizeHexColor, type HexColor } from '../color';

/**
 * The character formatting rich notes may store (fonts, sizes, text and highlight colors) and how a value is checked.
 * Every stored value comes from these lists or is a `#rrggbb` color, so a document never carries other CSS. The same
 * checks run in the editor's parse rules, the paste sanitizer and `normalizeRichDoc` (main).
 */

export interface FontFamilyOption {
  /** What a document stores. */
  key: string;
  label: string;
  /** The CSS font stack: the named font first, then look-alikes found on Linux, then the generic family. */
  stack: string;
  /** Lowercase family names that select this option when they come first in a pasted `font-family`. */
  names: readonly string[];
}

export const FONT_FAMILIES = [
  { key: 'serif', label: 'Serif', stack: 'Cambria, "Noto Serif", "DejaVu Serif", serif', names: ['serif', 'cambria', 'noto serif', 'dejavu serif'] },
  {
    key: 'mono',
    label: 'Monospace',
    stack: '"Cascadia Mono", Consolas, "Ubuntu Mono", "DejaVu Sans Mono", monospace',
    names: ['monospace', 'cascadia mono', 'consolas', 'ubuntu mono', 'dejavu sans mono'],
  },
  { key: 'arial', label: 'Arial', stack: 'Arial, "Liberation Sans", Arimo, Helvetica, sans-serif', names: ['arial', 'liberation sans', 'arimo', 'helvetica'] },
  {
    key: 'times',
    label: 'Times New Roman',
    stack: '"Times New Roman", "Liberation Serif", Tinos, Times, serif',
    names: ['times new roman', 'liberation serif', 'tinos', 'times'],
  },
  { key: 'courier', label: 'Courier New', stack: '"Courier New", "Liberation Mono", Cousine, Courier, monospace', names: ['courier new', 'liberation mono', 'cousine', 'courier'] },
  { key: 'georgia', label: 'Georgia', stack: 'Georgia, "Gelasio", "DejaVu Serif", serif', names: ['georgia', 'gelasio'] },
  { key: 'verdana', label: 'Verdana', stack: 'Verdana, "DejaVu Sans", "Bitstream Vera Sans", sans-serif', names: ['verdana', 'dejavu sans', 'bitstream vera sans'] },
] as const satisfies readonly FontFamilyOption[];

export type FontFamilyKey = (typeof FONT_FAMILIES)[number]['key'];

/** Font sizes in CSS pixels; the editor body is 15 px, which is the default (no size stored). */
export const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export interface ColorSwatch {
  label: string;
  value: HexColor;
}

/**
 * Text color presets: mid-tone colors with at least 3:1 contrast on both the light (#FFFFFF) and the dark (#17181D)
 * editor background, so colored text stays readable when the theme changes (tests/unit/formatting.test.ts).
 */
export const TEXT_COLORS: readonly ColorSwatch[] = [
  { label: 'Gray', value: '#7a7f8c' },
  { label: 'Red', value: '#e03131' },
  { label: 'Orange', value: '#d9480f' },
  { label: 'Brown', value: '#a16207' },
  { label: 'Green', value: '#2b8a3e' },
  { label: 'Teal', value: '#0c8599' },
  { label: 'Blue', value: '#1c7ed6' },
  { label: 'Violet', value: '#8b5cf6' },
  { label: 'Pink', value: '#d6336c' },
];

/** Highlight presets: light marker colors; highlighted text without its own color gets the ink that suits them. */
export const HIGHLIGHT_COLORS: readonly ColorSwatch[] = [
  { label: 'Yellow', value: '#fff3a3' },
  { label: 'Orange', value: '#ffd8a8' },
  { label: 'Green', value: '#c3f0c8' },
  { label: 'Blue', value: '#c5e1ff' },
  { label: 'Violet', value: '#e1d5ff' },
  { label: 'Pink', value: '#ffd1e1' },
  { label: 'Gray', value: '#e4e6ee' },
];

export function isFontFamilyKey(value: unknown): value is FontFamilyKey {
  return FONT_FAMILIES.some((f) => f.key === value);
}

export function fontStack(key: FontFamilyKey): string {
  return FONT_FAMILIES.find((f) => f.key === key)!.stack;
}

/** The option a CSS `font-family` value selects by its first family, or null when that font is not offered. */
export function fontFamilyFromCss(css: unknown): FontFamilyKey | null {
  if (typeof css !== 'string') return null;
  const first = css.split(',')[0]!.trim().replace(/^["']|["']$/g, '').toLowerCase();
  return FONT_FAMILIES.find((f) => (f.names as readonly string[]).includes(first))?.key ?? null;
}

/** A listed size, given in px or as the point size that equals it exactly (12pt = 16px); null otherwise. */
export function normalizeFontSize(value: unknown): FontSize | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)(px|pt)$/i.exec(value.trim());
  if (!match) return null;
  const px = match[2]!.toLowerCase() === 'pt' ? (Number(match[1]) * 4) / 3 : Number(match[1]);
  const size = `${px}px`;
  return (FONT_SIZES as readonly string[]).includes(size) ? (size as FontSize) : null;
}

/** The attributes of a stored `textStyle` mark. */
export interface TextStyleAttrs {
  color: HexColor | null;
  backgroundColor: HexColor | null;
  fontFamily: FontFamilyKey | null;
  fontSize: FontSize | null;
}

/** Validated `textStyle` attributes, or null when none is set (the mark is then dropped). */
export function normalizeTextStyle(raw: Record<string, unknown>): TextStyleAttrs | null {
  const attrs: TextStyleAttrs = {
    color: normalizeHexColor(raw.color),
    backgroundColor: normalizeHexColor(raw.backgroundColor),
    fontFamily: isFontFamilyKey(raw.fontFamily) ? raw.fontFamily : null,
    fontSize: normalizeFontSize(raw.fontSize),
  };
  return Object.values(attrs).some((v) => v !== null) ? attrs : null;
}

/**
 * Colors that pasted documents set on all of their text (black or white text, white highlights). Kept, they would make
 * pasted text unreadable in the other theme, so a paste drops them; chosen in the app they are kept.
 */
export const DOCUMENT_DEFAULT_TEXT: readonly string[] = ['#000000', '#ffffff'];
export const DOCUMENT_DEFAULT_BACKGROUND: readonly string[] = ['#ffffff'];
