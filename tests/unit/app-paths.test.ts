import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertNotInstallDir,
  isInside,
  resolveContained,
  resolveDataPaths,
  resolveUserDataOverride,
} from '../../src/main/app-paths';
import { testHooksEnabled } from '../../src/main/test-hooks';

describe('user data override (INF-FND-07)', () => {
  const abs = path.resolve('some', 'dir');

  it('unset gives null', () => {
    expect(resolveUserDataOverride(undefined)).toBeNull();
  });

  it('accepts an absolute path and normalizes it', () => {
    expect(resolveUserDataOverride(abs)).toEqual({ dir: abs });
    expect(resolveUserDataOverride(path.join(abs, 'a', '..', 'b'))).toEqual({ dir: path.join(abs, 'b') });
  });

  it('ignores empty, relative and NUL values with a reason', () => {
    expect(resolveUserDataOverride('')).toEqual({ ignored: 'empty value' });
    expect(resolveUserDataOverride('   ')).toEqual({ ignored: 'empty value' });
    expect(resolveUserDataOverride('relative/dir')).toEqual({ ignored: 'not an absolute path' });
    expect(resolveUserDataOverride(abs + '\0evil')).toEqual({ ignored: 'contains a NUL character' });
  });

  it('does not depend on isPackaged: the resolver has no packaged input and hooks differ', () => {
    expect(resolveUserDataOverride.length).toBe(1);
    expect(testHooksEnabled(false, { INFINITY_NOTES_E2E: '1' })).toBe(true);
    expect(testHooksEnabled(true, { INFINITY_NOTES_E2E: '1' })).toBe(false);
    expect(testHooksEnabled(false, {})).toBe(false);
  });
});

describe('data layout and containment', () => {
  it('resolveDataPaths layout', () => {
    const ud = path.resolve('ud');
    const p = resolveDataPaths(ud);
    expect(p.dbFile).toBe(path.join(ud, 'data', 'infinity-notes.sqlite3'));
    expect(p.logsDir).toBe(path.join(ud, 'logs'));
  });

  it('assertNotInstallDir throws inside the install dir, case-insensitive on win32', () => {
    expect(() => assertNotInstallDir('C:\\Program Files\\Infinity Notes\\data', 'C:\\Program Files\\Infinity Notes', 'win32')).toThrow();
    expect(() => assertNotInstallDir('c:\\program files\\infinity notes\\data', 'C:\\Program Files\\Infinity Notes', 'win32')).toThrow();
    expect(() => assertNotInstallDir('C:\\Program Files\\Infinity Notes', 'C:\\Program Files\\Infinity Notes', 'win32')).toThrow();
    expect(() => assertNotInstallDir('C:\\Users\\me\\AppData\\Roaming\\Infinity Notes\\data', 'C:\\Program Files\\Infinity Notes', 'win32')).not.toThrow();
    expect(() => assertNotInstallDir('/opt/infinity-notes-data/data', '/opt/infinity-notes', 'linux')).not.toThrow();
    expect(() => assertNotInstallDir('/opt/infinity-notes/data', '/opt/infinity-notes', 'linux')).toThrow();
  });

  it('resolveContained rejects parent segments, absolute paths and sibling prefixes', () => {
    const root = path.resolve('root', 'attachments');
    expect(resolveContained(root, 'ab/file.png')).toBe(path.join(root, 'ab', 'file.png'));
    expect(resolveContained(root, '../secret')).toBeNull();
    expect(resolveContained(root, 'ab/../../secret')).toBeNull();
    expect(resolveContained(root, path.resolve('elsewhere', 'x'))).toBeNull();
    expect(resolveContained(root, '../attachments-evil/x')).toBeNull();
    expect(resolveContained(root, '')).toBeNull();
    expect(resolveContained(root, 'a\0b')).toBeNull();
    expect(isInside(root, path.join(root, 'x'))).toBe(true);
    expect(isInside(root, root)).toBe(false);
  });
});
