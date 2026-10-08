import { describe, expect, it } from 'vitest';
import { detectStatusNotifierHost, parseNameHasOwner, type ExecFileFn } from '../../src/main/services/tray-probe';

const missing = Object.assign(new Error('spawn gdbus ENOENT'), { code: 'ENOENT' });

describe('tray host detection (INF-DESK-02, D-067)', () => {
  it('parses gdbus and dbus-send answers', () => {
    expect(parseNameHasOwner('(true,)\n')).toBe('present');
    expect(parseNameHasOwner('(false,)\n')).toBe('absent');
    expect(parseNameHasOwner('method return time=1.2 sender=org.freedesktop.DBus\n   boolean true\n')).toBe('present');
    expect(parseNameHasOwner('method return time=1.2 sender=org.freedesktop.DBus\n   boolean false\n')).toBe('absent');
    expect(parseNameHasOwner('')).toBe('unknown');
    expect(parseNameHasOwner('Error: org.freedesktop.DBus.Error.ServiceUnknown')).toBe('unknown');
    expect(parseNameHasOwner('(true, false)')).toBe('unknown');
  });

  it('asks gdbus with fixed arguments and no shell', async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const exec: ExecFileFn = async (file, args) => {
      calls.push({ file, args });
      return '(false,)\n';
    };
    expect(await detectStatusNotifierHost(exec)).toBe('absent');
    expect(calls).toEqual([
      {
        file: 'gdbus',
        args: ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.kde.StatusNotifierWatcher'],
      },
    ]);
  });

  it('falls back to dbus-send only when gdbus is not installed', async () => {
    const files: string[] = [];
    const exec: ExecFileFn = async (file) => {
      files.push(file);
      if (file === 'gdbus') throw missing;
      return '   boolean true\n';
    };
    expect(await detectStatusNotifierHost(exec)).toBe('present');
    expect(files).toEqual(['gdbus', 'dbus-send']);
  });

  it('an error, missing tools or the timeout give unknown', async () => {
    const failing: ExecFileFn = async () => {
      throw new Error('Cannot autolaunch D-Bus without X11 $DISPLAY');
    };
    expect(await detectStatusNotifierHost(failing)).toBe('unknown');
    const none: ExecFileFn = async () => {
      throw missing;
    };
    expect(await detectStatusNotifierHost(none)).toBe('unknown');
    // The first attempt uses up the whole budget, so dbus-send is never started.
    let t = 0;
    const files: string[] = [];
    const slow: ExecFileFn = async (file, _a, { timeoutMs }) => {
      files.push(file);
      t += timeoutMs;
      throw missing;
    };
    expect(await detectStatusNotifierHost(slow, 2000, () => t)).toBe('unknown');
    expect(files).toEqual(['gdbus']);
  });
});
