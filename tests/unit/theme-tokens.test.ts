import { describe, expect, it } from 'vitest';
import { themeTokens, tokenPx, tokenValue } from '../../src/shared/theme/tokens';

const css = `
/* comment { --bg: #000; } */
:root,
:root[data-theme='light'] { --bg: #ffffff; --text: #111111; }
:root[data-theme='dark'] { --bg: #17181d; }
:root { --header-h: 44px; }
.other { --bg: red; }
`;

describe('themeTokens (D-097)', () => {
  it('resolves tokens per theme like the cascade on the root element', () => {
    const light = themeTokens(css, 'light');
    const dark = themeTokens(css, 'dark');
    expect([light.get('--bg'), light.get('--text'), light.get('--header-h')]).toEqual(['#ffffff', '#111111', '44px']);
    expect([dark.get('--bg'), dark.get('--text'), dark.get('--header-h')]).toEqual(['#17181d', '#111111', '44px']);
  });

  it('refuses missing tokens and non-px lengths', () => {
    const t = themeTokens(css, 'light');
    expect(tokenPx(t, '--header-h')).toBe(44);
    expect(() => tokenValue(t, '--nope')).toThrow(/Missing design token --nope/);
    expect(() => tokenPx(t, '--bg')).toThrow(/not a px length/);
  });
});
