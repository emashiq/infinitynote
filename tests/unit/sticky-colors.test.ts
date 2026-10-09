import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NoteColor, StickyColorPreset } from '../../src/shared/contracts/hierarchy';
import { StickySetTextColorRequest } from '../../src/shared/contracts/stickies';
import { isPresetColor, STICKY_COLORS, stickyBackground } from '../../src/shared/sticky-colors';

/** Rows of the UX_SPEC section 10 table: color -> [light, dark]. */
function specColors(): Map<string, [string, string]> {
  const spec = fs.readFileSync(path.resolve('docs/UX_SPEC.md'), 'utf8');
  const section = spec.slice(spec.indexOf('## 10. Sticky colors'));
  const rows = new Map<string, [string, string]>();
  for (const m of section.matchAll(/^\| (\w+)(?: \(default\))? \| (#[0-9A-F]{6}) \| (#[0-9A-F]{6}) \|$/gm)) rows.set(m[1]!, [m[2]!, m[3]!]);
  return rows;
}

describe('sticky colors (INF-STKY-04, UX_SPEC section 10)', () => {
  it('has exactly the six preset colors', () => {
    expect(Object.keys(STICKY_COLORS)).toEqual(StickyColorPreset.options);
  });

  it('matches the UX_SPEC light and dark hex values', () => {
    const spec = specColors();
    expect([...spec.keys()]).toEqual(StickyColorPreset.options);
    for (const color of StickyColorPreset.options) {
      expect(stickyBackground(color, 'light'), color).toBe(spec.get(color)![0]);
      expect(stickyBackground(color, 'dark'), color).toBe(spec.get(color)![1]);
    }
  });

  it('a custom color is any lowercase #rrggbb and is shown as chosen in both themes', () => {
    expect(NoteColor.safeParse('#3a7bd5').success).toBe(true);
    expect(isPresetColor('#3a7bd5')).toBe(false);
    expect(isPresetColor('blue')).toBe(true);
    expect(stickyBackground('#3a7bd5', 'light')).toBe('#3a7bd5');
    expect(stickyBackground('#3a7bd5', 'dark')).toBe('#3a7bd5');
  });

  it.each(['#3A7BD5', '#fff', 'red', 'rgb(1, 2, 3)', '#12345g', '#1234567', 'url(x)', '#123456; color: red', '', null])('refuses the stored color %s', (value) => {
    expect(NoteColor.safeParse(value).success).toBe(false);
  });

  it('a default text color is a #rrggbb or null (Automatic)', () => {
    const noteId = crypto.randomUUID();
    expect(StickySetTextColorRequest.safeParse({ noteId, textColor: null }).success).toBe(true);
    expect(StickySetTextColorRequest.safeParse({ noteId, textColor: '#e03131' }).success).toBe(true);
    expect(StickySetTextColorRequest.safeParse({ noteId, textColor: 'red' }).success).toBe(false);
    expect(StickySetTextColorRequest.safeParse({ noteId }).success).toBe(false);
  });
});
