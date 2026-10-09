import { describe, expect, it } from 'vitest';
import { autostartCapability, createAutostartControl, desktopEntry, desktopExecArg, type AutostartAdapter } from '../../src/main/services/autostart';
import { memoryLogger } from '../../src/main/services/logger';

describe('launch at login builders (INF-DESK-03 mechanism, D-082)', () => {
  it('capability: installed Windows and Linux desktops only; development builds and WSL are unsupported', () => {
    expect(autostartCapability({ platform: 'win32', isPackaged: false, wsl: false })).toEqual({ status: 'unsupported', reason: 'development-build' });
    expect(autostartCapability({ platform: 'win32', isPackaged: true, wsl: false })).toEqual({ status: 'supported', reason: 'login-items' });
    expect(autostartCapability({ platform: 'linux', isPackaged: true, wsl: true })).toEqual({ status: 'unsupported', reason: 'wsl-no-session-autostart' });
    expect(autostartCapability({ platform: 'linux', isPackaged: true, wsl: false })).toEqual({ status: 'supported', reason: 'xdg-autostart' });
    expect(autostartCapability({ platform: 'darwin', isPackaged: true, wsl: false }).status).toBe('unsupported');
  });

  it('the desktop entry quotes the executable per the Desktop Entry spec (spaces, $, quotes, backslash, %)', () => {
    expect(desktopExecArg('/opt/Infinity Notes/infinity-notes')).toBe('"/opt/Infinity Notes/infinity-notes"');
    expect(desktopExecArg('/home/a/$HOME/app')).toBe('"/home/a/\\\\$HOME/app"');
    expect(desktopExecArg('/x/"q"`b`/a\\b/50%')).toBe('"/x/\\\\"q\\\\"\\\\`b\\\\`/a\\\\\\\\b/50%%"');
    expect(desktopEntry({ exec: '/opt/My Apps/$x/Infinity.AppImage', name: 'Infinity Notes' })).toBe(
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Infinity Notes',
        'Exec="/opt/My Apps/\\\\$x/Infinity.AppImage" --launched-at-login',
        'X-GNOME-Autostart-enabled=true',
        'NoDisplay=true',
        '',
      ].join('\n'),
    );
  });

  it('the control reads the OS state live, refuses changes where unsupported and reports a failed change', () => {
    const state = { enabled: false, fail: false };
    const adapter: AutostartAdapter = {
      isEnabled: () => state.enabled,
      setEnabled: (enabled) => {
        if (state.fail) throw new Error('access denied');
        state.enabled = enabled;
      },
    };
    let capability = { status: 'supported' as 'supported' | 'unsupported', reason: 'login-items' };
    const logger = memoryLogger();
    const control = createAutostartControl({ adapter, capability: () => capability, logger });
    expect(control.get()).toEqual({ enabled: false, capability });
    expect(control.set(true)).toEqual({ enabled: true, capability });
    state.fail = true;
    expect(() => control.set(false)).toThrow('Could not change the startup setting');
    expect(state.enabled).toBe(true);
    expect(logger.lines).toEqual(['INFO autostart: set enabled=true result=ok', 'ERROR autostart: set enabled=false result=error access denied']);
    capability = { status: 'unsupported', reason: 'development-build' };
    expect(control.get()).toEqual({ enabled: false, capability });
    expect(() => control.set(true)).toThrow('Not supported by this desktop');
  });
});
