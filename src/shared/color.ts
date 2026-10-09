/**
 * Color values the app stores and how text stays readable on them. Every stored color is a lowercase `#rrggbb`;
 * anything else (named colors, `rgba()`, CSS expressions) is refused, so a stored value can never carry other CSS.
 */

export type HexColor = `#${string}`;

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/;

const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const LONG_HEX = /^#[0-9a-f]{6}$/i;
const RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` as a lowercase `#rrggbb`, or null for anything else. */
export function normalizeHexColor(value: unknown): HexColor | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (LONG_HEX.test(text)) return text.toLowerCase() as HexColor;
  const short = SHORT_HEX.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase() as HexColor;
  const rgb = RGB.exec(text);
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((c) => c > 255)) return null;
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}` as HexColor;
}

/** WCAG 2.x relative luminance of a `#rrggbb` color. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio of two `#rrggbb` colors (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * Text on a background of any color: black or white, whichever contrasts more, which is at least 4.58:1 on every
 * color (softer inks fall below 4.5:1 on mid-tones).
 */
export const INK = { dark: '#000000', light: '#ffffff' } as const;
export type Ink = keyof typeof INK;

/** The ink with the higher contrast on a background. */
export function inkFor(background: string): Ink {
  return contrast(background, INK.dark) >= contrast(background, INK.light) ? 'dark' : 'light';
}
