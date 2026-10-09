import { describe, expect, it } from 'vitest';
import { contrast, INK, inkFor, normalizeHexColor } from '../../src/shared/color';
import {
  FONT_FAMILIES,
  fontFamilyFromCss,
  HIGHLIGHT_COLORS,
  isFontFamilyKey,
  normalizeFontSize,
  normalizeTextStyle,
  TEXT_COLORS,
} from '../../src/shared/editor/formatting';
import { themeTokens, tokenValue } from '../../src/shared/theme/tokens';
import fs from 'node:fs';

const css = fs.readFileSync('src/shared/theme/tokens.css', 'utf8');
const editorBackground = { light: tokenValue(themeTokens(css, 'light'), '--bg'), dark: tokenValue(themeTokens(css, 'dark'), '--bg') };

describe('stored colors', () => {
  it.each([
    ['#E03131', '#e03131'],
    ['  #abc ', '#aabbcc'],
    ['rgb(224, 49, 49)', '#e03131'],
    ['RGB(0,0,0)', '#000000'],
  ])('%s is stored as %s', (input, stored) => {
    expect(normalizeHexColor(input)).toBe(stored);
  });

  it.each(['red', 'transparent', 'rgba(0, 0, 0, 0)', 'rgb(256, 0, 0)', '#12345', '#1234567', '#ggg', 'url(x)', 'expression(alert(1))', '#e03131;color:red', '', null, 3])(
    '%s is refused',
    (input) => {
      expect(normalizeHexColor(input)).toBeNull();
    },
  );

  it('the ink on any color is black or white, whichever reads better: at least 4.5:1 on every color', () => {
    expect(inkFor('#fff3a3')).toBe('dark');
    expect(inkFor('#22344f')).toBe('light');
    // Every 17th step of each channel, mid-tones included.
    for (let r = 0; r < 256; r += 17)
      for (let g = 0; g < 256; g += 17)
        for (let b = 0; b < 256; b += 17) {
          const bg = normalizeHexColor(`rgb(${r}, ${g}, ${b})`)!;
          expect(contrast(bg, INK[inkFor(bg)]), bg).toBeGreaterThanOrEqual(4.5);
        }
  });
});

describe('formatting values (fonts, sizes, colors)', () => {
  it('fonts are offered by key; a pasted font list selects one by its first family only', () => {
    expect(FONT_FAMILIES.map((f) => f.label)).toEqual(['Serif', 'Monospace', 'Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana']);
    for (const f of FONT_FAMILIES) {
      // The stack names the font first, then look-alikes, then a generic family, so every OS shows something close.
      expect(f.stack).toMatch(/(serif|sans-serif|monospace)$/);
      expect(fontFamilyFromCss(f.stack), f.key).toBe(f.key);
    }
    expect(fontFamilyFromCss('"Times New Roman", serif')).toBe('times');
    expect(fontFamilyFromCss("'Liberation Mono'")).toBe('courier');
    expect(fontFamilyFromCss('Calibri, Arial, sans-serif')).toBeNull();
    expect(fontFamilyFromCss('Comic Sans MS')).toBeNull();
    expect(isFontFamilyKey('arial')).toBe(true);
    expect(isFontFamilyKey('Arial')).toBe(false);
  });

  it('sizes come from the list, in px or as the equal point size', () => {
    expect(normalizeFontSize('18px')).toBe('18px');
    expect(normalizeFontSize('13.5pt')).toBe('18px');
    expect(normalizeFontSize('12pt')).toBe('16px');
    for (const bad of ['15px', '13px', '11pt', '2em', '120%', 'large', 'calc(1px + 2px)', '18 px']) expect(normalizeFontSize(bad), bad).toBeNull();
  });

  it('a stored text style keeps only valid values and is dropped when none is left', () => {
    expect(normalizeTextStyle({ color: '#E03131', backgroundColor: 'red', fontFamily: 'mono', fontSize: '13px', extra: 'x' })).toEqual({
      color: '#e03131',
      backgroundColor: null,
      fontFamily: 'mono',
      fontSize: null,
    });
    expect(normalizeTextStyle({ color: 'red', fontFamily: 'Papyrus' })).toBeNull();
  });

  it('text color presets read at 3:1 or better on both the light and the dark editor background', () => {
    for (const { label, value } of TEXT_COLORS) {
      expect(contrast(value, editorBackground.light), `${label} on light`).toBeGreaterThanOrEqual(3);
      expect(contrast(value, editorBackground.dark), `${label} on dark`).toBeGreaterThanOrEqual(3);
    }
  });

  it('highlight presets carry readable ink (4.5:1)', () => {
    for (const { label, value } of HIGHLIGHT_COLORS) expect(contrast(value, INK[inkFor(value)]), label).toBeGreaterThanOrEqual(4.5);
  });
});
