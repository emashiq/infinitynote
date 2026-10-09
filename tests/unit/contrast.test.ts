import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { themeTokens, tokenValue, type ThemeName } from '../../src/shared/theme/tokens';

const css = fs.readFileSync('src/shared/theme/tokens.css', 'utf8');

/** WCAG 2.x relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Text drawn on a surface (4.5:1, WCAG 1.4.3). */
const TEXT_PAIRS: ReadonlyArray<[string, string]> = [
  ['--text', '--bg'],
  ['--text', '--bg-rail'],
  ['--text', '--bg-subtle'],
  ['--text', '--accent-soft'],
  ['--text-muted', '--bg'],
  ['--text-muted', '--bg-rail'],
  ['--text-muted', '--bg-subtle'],
  ['--accent', '--bg'],
  ['--accent', '--bg-subtle'],
  ['--accent', '--accent-soft'],
  ['--on-accent', '--accent'],
  ['--on-accent', '--accent-hover'],
  ['--danger', '--bg'],
  ['--warning', '--bg'],
  ['--success', '--bg'],
];

/** Boundaries that identify a control or its state: input, button and switch borders, the focus ring (3:1, WCAG 1.4.11). */
const BOUNDARY_PAIRS: ReadonlyArray<[string, string]> = [
  ['--border-strong', '--bg'],
  ['--border-strong', '--bg-subtle'],
  ['--border-strong', '--bg-rail'],
  ['--accent', '--bg'],
  ['--accent', '--bg-subtle'],
  ['--accent', '--bg-rail'],
  ['--text-muted', '--bg-subtle'],
];

describe('contrast (INF-A11Y-04)', () => {
  for (const theme of ['light', 'dark'] as ThemeName[]) {
    const tokens = themeTokens(css, theme);
    const ratio = (fg: string, bg: string) => contrast(tokenValue(tokens, fg), tokenValue(tokens, bg));

    it(`token pairs: ${theme} text is at least 4.5:1`, () => {
      const failing = TEXT_PAIRS.filter(([fg, bg]) => ratio(fg, bg) < 4.5).map(([fg, bg]) => `${fg} on ${bg}: ${ratio(fg, bg).toFixed(2)}`);
      expect(failing).toEqual([]);
    });

    it(`token pairs: ${theme} control boundaries are at least 3:1`, () => {
      const failing = BOUNDARY_PAIRS.filter(([fg, bg]) => ratio(fg, bg) < 3).map(([fg, bg]) => `${fg} on ${bg}: ${ratio(fg, bg).toFixed(2)}`);
      expect(failing).toEqual([]);
    });
  }

  it('interactive controls draw their outline with the strong border token', () => {
    const styles = ['base.css', 'components.css'].map((f) => fs.readFileSync(`src/renderer/styles/${f}`, 'utf8')).join('\n');
    for (const selector of ['.btn {', '.text-input,', '.switch {']) {
      const start = styles.indexOf(selector);
      expect(start, selector).toBeGreaterThanOrEqual(0);
      const rule = styles.slice(start, styles.indexOf('}', start));
      expect(rule, selector).toContain('var(--border-strong)');
    }
  });
});
