import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

const { mainWindowOptions } = await import('../../src/main/windows/main-window');

describe('mainWindowOptions (INF-SHELL-06)', () => {
  const opts = mainWindowOptions({ preloadPath: '/p/preload.js', iconPath: '/i/icon.png', platform: 'linux' });

  it('uses the native frame and menu bar behaviour', () => {
    expect(opts).not.toHaveProperty('frame');
    expect(opts).not.toHaveProperty('titleBarStyle');
    expect(opts).not.toHaveProperty('transparent');
    expect(opts.autoHideMenuBar).toBe(true);
  });

  it('keeps the sizes and the secure web preferences', () => {
    expect(opts).toMatchObject({ width: 1100, height: 720, minWidth: 720, minHeight: 480, show: false });
    expect(opts.webPreferences).toEqual({
      preload: '/p/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      safeDialogs: true,
    });
    expect(opts.webPreferences).toMatchObject({
      preload: '/p/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
    });
  });

  it('sets the icon on Linux only', () => {
    expect(opts.icon).toBe('/i/icon.png');
    expect(mainWindowOptions({ preloadPath: 'x', iconPath: 'y', platform: 'win32' })).not.toHaveProperty('icon');
  });
});
