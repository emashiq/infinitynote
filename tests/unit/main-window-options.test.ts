import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, nativeTheme: {} }));

const { mainWindowOptions, TITLE_BAR_HEIGHT } = await import('../../src/main/windows/main-window');

describe('mainWindowOptions (INF-SHELL-06)', () => {
  const opts = mainWindowOptions({ preloadPath: '/p/preload.js', iconPath: '/i/icon.png', platform: 'linux' });

  it('has no OS title bar: the app draws it and the OS draws the caption buttons over it in the theme colors (D-097)', () => {
    expect(opts).not.toHaveProperty('frame');
    expect(opts).not.toHaveProperty('transparent');
    expect(opts).not.toHaveProperty('autoHideMenuBar');
    expect(opts.titleBarStyle).toBe('hidden');
    expect(TITLE_BAR_HEIGHT).toBe(44);
    expect(opts.titleBarOverlay).toEqual({ color: '#ffffff', symbolColor: '#1d2030', height: 44 });
    expect(mainWindowOptions({ preloadPath: 'x', iconPath: 'y', dark: true }).titleBarOverlay).toEqual({ color: '#17181d', symbolColor: '#e7e8ee', height: 44 });
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
