// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyTheme, resolveTheme } from '../../../src/renderer/theme/theme';

describe('theme', () => {
  it('resolveTheme matrix', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('applyTheme sets data-theme', () => {
    applyTheme(document.documentElement, 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme(document.documentElement, 'light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
