import { describe, expect, it } from 'vitest';
import { applyCapabilityOverride, detectCapabilities, type CapabilityInputs } from '../../src/main/services/capabilities';

const base: CapabilityInputs = {
  platform: 'linux',
  ozonePlatform: null,
  xdgSessionType: null,
  waylandDisplay: null,
  display: null,
  wslDistro: null,
  wslgVersion: null,
  statusNotifierHost: null,
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
      for (const key of ['nativeNotifications', 'launchAtLogin', 'globalShortcut'] as const) {
        expect(c[key]).toEqual({ status: 'unknown', reason: 'detected-in-later-phase' });
      }
    }
  });
});

describe('tray capability (INF-DESK-02, INF-STKY-13, D-067)', () => {
  it('Windows always has a tray', () => {
    expect(detectCapabilities({ ...base, platform: 'win32' }).tray).toEqual({ status: 'supported', reason: 'native-windows' });
  });

  it('Linux maps the StatusNotifier host probe to supported, unsupported or unknown', () => {
    const wslg = { ...base, wslDistro: 'Ubuntu', wslgVersion: 'WSLg 1.0.73', display: ':0', waylandDisplay: 'wayland-0' };
    expect(detectCapabilities({ ...wslg, statusNotifierHost: 'present' }).tray).toEqual({ status: 'supported', reason: 'status-notifier-host' });
    expect(detectCapabilities({ ...wslg, statusNotifierHost: 'absent' }).tray).toEqual({ status: 'unsupported', reason: 'no-status-notifier-host' });
    expect(detectCapabilities({ ...wslg, statusNotifierHost: 'unknown' }).tray).toEqual({ status: 'unknown', reason: 'status-notifier-host-unknown' });
    const x11 = { ...base, xdgSessionType: 'x11', display: ':0' };
    expect(detectCapabilities({ ...x11, statusNotifierHost: 'present' }).tray.status).toBe('supported');
    expect(detectCapabilities({ ...x11, statusNotifierHost: null }).tray.status).toBe('unknown');
  });

  it('WSLg keeps positioning and always-on-top unsupported whatever the tray host', () => {
    const c = detectCapabilities({ ...base, wslDistro: 'Ubuntu', statusNotifierHost: 'present' });
    expect(c.windowPositioning).toEqual({ status: 'unsupported', reason: 'wayland-or-wslg' });
    expect(c.alwaysOnTop).toEqual({ status: 'unsupported', reason: 'wayland-or-wslg' });
  });
});

describe('test capability override (plan section 8.9)', () => {
  const win = detectCapabilities({ ...base, platform: 'win32' });

  it('sets the named statuses with the reason test-override and ignores unknown keys and values', () => {
    const { caps, warning } = applyCapabilityOverride(win, JSON.stringify({ windowPositioning: 'unsupported', tray: 'unknown', alwaysOnTop: 'maybe', nativeNotifications: 'supported' }));
    expect(warning).toBeNull();
    expect(caps.windowPositioning).toEqual({ status: 'unsupported', reason: 'test-override' });
    expect(caps.tray).toEqual({ status: 'unknown', reason: 'test-override' });
    expect(caps.alwaysOnTop).toEqual(win.alwaysOnTop);
    expect(caps.nativeNotifications).toEqual(win.nativeNotifications);
  });

  it('leaves the capabilities unchanged for invalid JSON, a non-object or no value', () => {
    expect(applyCapabilityOverride(win, '{nope')).toEqual({ caps: win, warning: 'INFINITY_NOTES_TEST_CAPS ignored: invalid JSON' });
    expect(applyCapabilityOverride(win, '["tray"]')).toEqual({ caps: win, warning: 'INFINITY_NOTES_TEST_CAPS ignored: not an object' });
    expect(applyCapabilityOverride(win, undefined)).toEqual({ caps: win, warning: null });
  });
});
