import { describe, expect, it } from 'vitest';
import { matchShortcut, type KeyLike } from '../../src/renderer/state/shortcuts';

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  code: k.length === 1 ? `Key${k.toUpperCase()}` : k,
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...extra,
});

describe('matchShortcut', () => {
  it('maps each shortcut', () => {
    expect(matchShortcut(key('n'))).toBe('note.new');
    expect(matchShortcut(key('N', { shiftKey: true }))).toBe('sticky.new');
    expect(matchShortcut(key('w'))).toBe('tab.close');
    expect(matchShortcut(key('Tab'))).toBe('tab.next');
    expect(matchShortcut(key('Tab', { shiftKey: true }))).toBe('tab.prev');
    expect(matchShortcut(key('k'))).toBe('palette.open');
  });

  it('is case-insensitive for letters', () => {
    expect(matchShortcut(key('N'))).toBe('note.new');
    expect(matchShortcut(key('K'))).toBe('palette.open');
    expect(matchShortcut(key('n', { shiftKey: true }))).toBe('sticky.new');
  });

  it('matches Backslash by code, with Shift for the panel', () => {
    expect(matchShortcut(key('\\', { code: 'Backslash' }))).toBe('view.toggleTree');
    expect(matchShortcut(key('|', { code: 'Backslash', shiftKey: true }))).toBe('view.togglePanel');
    expect(matchShortcut(key('\\', { code: 'IntlBackslash' }))).toBeNull();
  });

  it('ignores Alt, Meta and events without Ctrl', () => {
    expect(matchShortcut(key('n', { altKey: true }))).toBeNull();
    expect(matchShortcut(key('n', { metaKey: true }))).toBeNull();
    expect(matchShortcut(key('n', { ctrlKey: false }))).toBeNull();
    expect(matchShortcut(key('\\', { code: 'Backslash', altKey: true }))).toBeNull();
  });

  it('does not claim Ctrl+Shift+W or Ctrl+Shift+K', () => {
    expect(matchShortcut(key('W', { shiftKey: true }))).toBeNull();
    expect(matchShortcut(key('K', { shiftKey: true }))).toBeNull();
    expect(matchShortcut(key('x'))).toBeNull();
  });
});
