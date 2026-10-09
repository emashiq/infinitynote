import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTOSTART_FILE, createXdgAutostart, desktopEntry } from '../../src/main/services/autostart';
import { mkTmp } from './helpers';

describe('XDG autostart entry (INF-DESK-03 mechanism, D-082)', () => {
  it('writes, reads back and removes infinity-notes.desktop under a temporary XDG_CONFIG_HOME', () => {
    const configHome = mkTmp('infinity-xdg-');
    const exec = path.join(configHome, 'Apps With Space', 'Infinity Notes.AppImage');
    const adapter = createXdgAutostart({ configHome, exec, name: 'Infinity Notes' });
    const file = path.join(configHome, 'autostart', AUTOSTART_FILE);
    expect(adapter.isEnabled()).toBe(false);
    adapter.setEnabled(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(desktopEntry({ exec, name: 'Infinity Notes' }));
    expect(adapter.isEnabled()).toBe(true);
    // Atomic: only the final file is left behind.
    expect(fs.readdirSync(path.dirname(file))).toEqual([AUTOSTART_FILE]);
    // An entry for another executable does not count as this app's.
    expect(createXdgAutostart({ configHome, exec: '/usr/bin/other', name: 'Infinity Notes' }).isEnabled()).toBe(false);
    adapter.setEnabled(false);
    expect(fs.existsSync(file)).toBe(false);
    expect(adapter.isEnabled()).toBe(false);
    adapter.setEnabled(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('a failed write leaves the previous state', () => {
    const configHome = mkTmp('infinity-xdg-');
    // A file where the autostart directory should be makes the write fail.
    fs.writeFileSync(path.join(configHome, 'autostart'), 'not a directory');
    const adapter = createXdgAutostart({ configHome, exec: '/opt/infinity-notes', name: 'Infinity Notes' });
    expect(() => adapter.setEnabled(true)).toThrow();
    expect(adapter.isEnabled()).toBe(false);
  });
});
