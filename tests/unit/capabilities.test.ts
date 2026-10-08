import { describe, expect, it } from 'vitest';
import { detectCapabilities, type CapabilityInputs } from '../../src/main/services/capabilities';

const base: CapabilityInputs = {
  platform: 'linux',
  ozonePlatform: null,
  xdgSessionType: null,
  waylandDisplay: null,
  display: null,
  wslDistro: null,
  wslgVersion: null,
};

describe('capabilities (W01-14)', () => {
  it('win32 supports positioning and always-on-top', () => {
    const c = detectCapabilities({ ...base, platform: 'win32' });
    expect(c.environment).toBe('windows');
    expect(c.windowPositioning.status).toBe('supported');
    expect(c.alwaysOnTop.status).toBe('supported');
  });

  it('Linux Wayland is unsupported for positioning and always-on-top', () => {
    const c = detectCapabilities({ ...base, ozonePlatform: 'wayland', xdgSessionType: 'wayland', waylandDisplay: 'wayland-0' });
    expect(c.sessionType).toBe('wayland');
    expect(c.windowPositioning).toEqual({ status: 'unsupported', reason: 'wayland-or-wslg' });
    expect(c.alwaysOnTop).toEqual({ status: 'unsupported', reason: 'wayland-or-wslg' });
  });

  it('Linux X11 (non-WSL) supports positioning, always-on-top unknown', () => {
    const c = detectCapabilities({ ...base, xdgSessionType: 'x11', display: ':0' });
    expect(c.environment).toBe('linux-desktop');
    expect(c.sessionType).toBe('x11');
    expect(c.windowPositioning).toEqual({ status: 'supported', reason: 'window-manager-may-adjust' });
    expect(c.alwaysOnTop.status).toBe('unknown');
  });

  it('WSLg with ozone x11 is still unsupported for positioning', () => {
    const c = detectCapabilities({ ...base, ozonePlatform: 'x11', wslDistro: 'Ubuntu', wslgVersion: 'WSLg 1.0.73', display: ':0', waylandDisplay: 'wayland-0' });
    expect(c.environment).toBe('wslg');
    expect(c.windowPositioning.status).toBe('unsupported');
    expect(c.alwaysOnTop.status).toBe('unsupported');
  });

  it('notificationActions is always unsupported; later-phase fields stay unknown', () => {
    for (const input of [{ ...base, platform: 'win32' }, base, { ...base, ozonePlatform: 'wayland' }, { ...base, wslDistro: 'Ubuntu' }, { ...base, platform: 'darwin' }]) {
      const c = detectCapabilities(input);
      expect(c.notificationActions.status).toBe('unsupported');
      for (const key of ['tray', 'nativeNotifications', 'launchAtLogin', 'globalShortcut'] as const) {
        expect(c[key]).toEqual({ status: 'unknown', reason: 'detected-in-later-phase' });
      }
    }
  });
});
