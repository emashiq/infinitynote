// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyStickyAppearance } from '../../../src/renderer/stickies/sticky-appearance';

describe('sticky colors on the page root (v0.2.0)', () => {
  it('a preset is named on the root, so its theme variant comes from CSS; nothing is inline', () => {
    const root = document.createElement('html');
    applyStickyAppearance(root, { color: 'green', textColor: null });
    expect(root.dataset.stickyColor).toBe('green');
    expect(root.dataset.stickyInk).toBeUndefined();
    expect(root.style.getPropertyValue('--sticky-bg')).toBe('');
    expect(root.style.getPropertyValue('--sticky-text')).toBe('');
  });

  it('a custom color is set as is with the ink that reads on it; a default text color replaces the ink', () => {
    const root = document.createElement('html');
    applyStickyAppearance(root, { color: '#fff3a3', textColor: null });
    expect([root.dataset.stickyColor, root.dataset.stickyInk, root.style.getPropertyValue('--sticky-bg')]).toEqual(['custom', 'dark', '#fff3a3']);
    const cleanup = applyStickyAppearance(root, { color: '#22344f', textColor: '#e03131' });
    expect([root.dataset.stickyInk, root.style.getPropertyValue('--sticky-bg'), root.style.getPropertyValue('--sticky-text')]).toEqual(['light', '#22344f', '#e03131']);

    applyStickyAppearance(root, { color: 'blue', textColor: null });
    expect([root.dataset.stickyColor, root.dataset.stickyInk, root.style.getPropertyValue('--sticky-bg'), root.style.getPropertyValue('--sticky-text')]).toEqual(['blue', undefined, '', '']);
    cleanup();
    expect(root.dataset.stickyColor).toBeUndefined();
  });
});
