import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NoteColor } from '../../src/shared/contracts/hierarchy';
import { STICKY_COLORS, stickyBackground } from '../../src/shared/sticky-colors';

/** Rows of the UX_SPEC section 10 table: color -> [light, dark]. */
function specColors(): Map<string, [string, string]> {
  const spec = fs.readFileSync(path.resolve('docs/UX_SPEC.md'), 'utf8');
  const section = spec.slice(spec.indexOf('## 10. Sticky colors'));
  const rows = new Map<string, [string, string]>();
  for (const m of section.matchAll(/^\| (\w+)(?: \(default\))? \| (#[0-9A-F]{6}) \| (#[0-9A-F]{6}) \|$/gm)) rows.set(m[1]!, [m[2]!, m[3]!]);
  return rows;
}

describe('sticky colors (INF-STKY-04, UX_SPEC section 10)', () => {
  it('has exactly the six note colors', () => {
    expect(Object.keys(STICKY_COLORS)).toEqual(NoteColor.options);
  });

  it('matches the UX_SPEC light and dark hex values', () => {
    const spec = specColors();
    expect([...spec.keys()]).toEqual(NoteColor.options);
    for (const color of NoteColor.options) {
      expect(stickyBackground(color, 'light'), color).toBe(spec.get(color)![0]);
      expect(stickyBackground(color, 'dark'), color).toBe(spec.get(color)![1]);
    }
  });
});
