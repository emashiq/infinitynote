import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scrollBehavior } from '../../src/renderer/ui/motion';

const STYLES = 'src/renderer/styles';
const read = (file: string) => fs.readFileSync(path.join(STYLES, file), 'utf8');

/** The body of the first `@media (prefers-reduced-motion: reduce)` block. */
function reducedMotionBlock(css: string): string | null {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
  if (start < 0) return null;
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  return null;
}

describe('reduced motion (INF-A11Y-05)', () => {
  it('one global rule turns off transitions, animations and smooth scrolling for every element and pseudo-element', () => {
    const block = reducedMotionBlock(read('base.css'));
    expect(block).not.toBeNull();
    expect(block).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
    for (const declaration of ['transition: none !important', 'animation: none !important', 'scroll-behavior: auto !important']) {
      expect(block).toContain(declaration);
    }
  });

  it('every stylesheet with motion is loaded together with that rule', () => {
    const withMotion = fs.readdirSync(STYLES).filter((f) => f.endsWith('.css') && /\b(transition|animation)\s*:\s*(?!none)/.test(read(f)));
    expect(withMotion.length).toBeGreaterThan(0);
    const entry = fs.readFileSync('src/renderer/main.tsx', 'utf8');
    for (const file of [...withMotion, 'base.css']) expect(entry, file).toContain(`styles/${file}`);
  });

  it('scripted scrolling is instant when reduced motion is on', () => {
    expect(scrollBehavior((q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }))).toBe('auto');
    expect(scrollBehavior(() => ({ matches: false }))).toBe('smooth');
    expect(scrollBehavior(undefined)).toBe('smooth');
  });
});
