import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync('src/renderer/styles/tokens.css', 'utf8');
const spec = fs.readFileSync('docs/UX_SPEC.md', 'utf8');

function block(selectorPattern: RegExp): string {
  const m = selectorPattern.exec(css);
  if (!m) throw new Error(`selector not found: ${selectorPattern}`);
  const end = css.indexOf('}', m.index);
  return css.slice(m.index, end);
}

function tokensOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim().toLowerCase());
  return out;
}

describe('UX_SPEC section 3 tokens (INF-SHELL-05)', () => {
  const specSection = spec.slice(spec.indexOf('## 3. Tokens'), spec.indexOf('## 4.'));
  const rows = [...specSection.matchAll(/^\| `(--[a-z-]+)` \| (#[0-9A-Fa-f]{6}) \| (#[0-9A-Fa-f]{6}) \|$/gm)];
  const light = tokensOf(block(/:root,\s*\n:root\[data-theme='light'\]\s*\{/));
  const dark = tokensOf(block(/:root\[data-theme='dark'\]\s*\{/));

  it('the spec table has 13 tokens', () => {
    expect(rows).toHaveLength(13);
  });

  it('every token has the stated light and dark value', () => {
    for (const [, token, l, d] of rows) {
      expect(light.get(token!), `${token} light`).toBe(l!.toLowerCase());
      expect(dark.get(token!), `${token} dark`).toBe(d!.toLowerCase());
    }
  });

  it('radii are 8 px for panels and 6 px for controls', () => {
    const root = tokensOf(block(/:root\s*\{\s*\n\s*--radius-panel/));
    expect(root.get('--radius-panel')).toBe('8px');
    expect(root.get('--radius-control')).toBe('6px');
  });
});
