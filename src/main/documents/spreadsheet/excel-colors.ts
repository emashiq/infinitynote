/**
 * Excel colors as the workbook model keeps them (`#rrggbb`, D-136): explicit ARGB values, theme colors of the
 * default Office theme with their tint, and the legacy indexed palette. Part of the workbook worker, so it imports
 * nothing main's own bundle loads.
 */

/** An ExcelJS color: `argb`, or a `theme` index with an optional `tint`, or a legacy `indexed` entry. */
export interface ExcelColor {
  argb?: string;
  theme?: number;
  tint?: number;
  indexed?: number;
}

/** The Office theme (2013 onward) in Excel's theme index order: lt1, dk1, lt2, dk2, accent1-6, hyperlink, followed. */
const THEME = ['ffffff', '000000', 'e7e6e6', '44546a', '4472c4', 'ed7d31', 'a5a5a5', 'ffc000', '5b9bd5', '70ad47', '0563c1', '954f72'];

/** The legacy palette of `indexed` colors (ECMA-376 Part 1, 18.8.27); 64 and above are the system colors. */
const INDEXED = [
  '000000', 'ffffff', 'ff0000', '00ff00', '0000ff', 'ffff00', 'ff00ff', '00ffff',
  '000000', 'ffffff', 'ff0000', '00ff00', '0000ff', 'ffff00', 'ff00ff', '00ffff',
  '800000', '008000', '000080', '808000', '800080', '008080', 'c0c0c0', '808080',
  '9999ff', '993366', 'ffffcc', 'ccffff', '660066', 'ff8080', '0066cc', 'ccccff',
  '000080', 'ff00ff', 'ffff00', '00ffff', '800080', '800000', '008080', '0000ff',
  '00ccff', 'ccffff', 'ccffcc', 'ffff99', '99ccff', 'ff99cc', 'cc99ff', 'ffcc99',
  '3366ff', '33cccc', '99cc00', 'ffcc00', 'ff9900', 'ff6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];
/** System foreground and background (indexed 64 and 65). */
const SYSTEM = { 64: '000000', 65: 'ffffff' } as Record<number, string>;

/** Applies an Excel tint (-1 darker … 1 lighter) to a color through its HSL lightness, as Excel does. */
function tinted(hex: string, tint: number): string {
  if (!tint) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const rgb = s === 0 ? [l, l, l] : [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  return rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

/** The `#rrggbb` of an Excel color, or null when it names none this mapping knows (the cell keeps its default). */
export function hexOfExcelColor(color: ExcelColor | undefined): string | null {
  if (!color) return null;
  let base: string | undefined;
  if (typeof color.argb === 'string' && /^[0-9a-f]{6,8}$/i.test(color.argb)) base = color.argb.slice(-6).toLowerCase();
  else if (typeof color.theme === 'number') base = THEME[color.theme];
  else if (typeof color.indexed === 'number') base = INDEXED[color.indexed] ?? SYSTEM[color.indexed];
  return base === undefined ? null : `#${tinted(base, color.tint ?? 0)}`;
}

/** The ARGB ExcelJS writes for a model color. */
export function argbOf(hex: string): { argb: string } {
  return { argb: `FF${hex.slice(1).toUpperCase()}` };
}
