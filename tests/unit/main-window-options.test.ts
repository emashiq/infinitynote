import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { themeTokens } from '../../src/shared/theme/tokens';

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
    // The caption area ends above the bar's 1 px bottom border, so the border line runs under the buttons.
    expect(opts.titleBarOverlay).toEqual({ color: '#ffffff', symbolColor: '#1d2030', height: 43 });
    expect(mainWindowOptions({ preloadPath: 'x', iconPath: 'y', dark: true }).titleBarOverlay).toEqual({ color: '#17181d', symbolColor: '#e7e8ee', height: 43 });
  });

  it('takes the overlay colours and height from the same design tokens the bar uses (D-097)', () => {
    const css = fs.readFileSync('src/shared/theme/tokens.css', 'utf8');
    for (const dark of [false, true]) {
      const t = themeTokens(css, dark ? 'dark' : 'light');
      const bar = mainWindowOptions({ preloadPath: 'x', iconPath: 'y', dark }).titleBarOverlay;
      expect(bar).toEqual({ color: t.get('--bg'), symbolColor: t.get('--text'), height: parseInt(t.get('--header-h')!, 10) - parseInt(t.get('--header-border')!, 10) });
    }
    const shell = fs.readFileSync('src/renderer/styles/shell.css', 'utf8');
    const start = shell.search(/^\.app-header \{/m);
    const header = shell.slice(start, shell.indexOf('}', start));
    expect(header).toContain('height: var(--header-h);');
    expect(header).toContain('border-bottom: var(--header-border) solid var(--border);');
    expect(header).toContain('background: var(--bg);');
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
