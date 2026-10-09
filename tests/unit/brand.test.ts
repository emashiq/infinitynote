// @vitest-environment jsdom
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissStartupLoader, STARTUP_LOADER_ID } from '../../src/renderer/startup/startup-loader';
import { themeTokens } from '../../src/shared/theme/tokens';

vi.mock('electron', () => ({ BrowserWindow: class {}, nativeTheme: {}, Menu: {}, Tray: class {}, nativeImage: {} }));

const { trayIconFiles } = await import('../../src/main/tray');
const { mainWindowOptions, windowBackground } = await import('../../src/main/windows/main-window');

const tokens = fs.readFileSync('src/shared/theme/tokens.css', 'utf8');
const startupCss = fs.readFileSync('src/renderer/styles/startup.css', 'utf8');
const indexHtml = fs.readFileSync('src/renderer/index.html', 'utf8');

/** The background and text colors of a CSS block that starts at `from`. */
function colorsAfter(css: string, from: number): { background: string; color: string } {
  const block = css.slice(from, css.indexOf('}', from));
  return { background: /background: (#[0-9a-f]{6})/.exec(block)![1]!, color: /\scolor: (#[0-9a-f]{6})/.exec(block)![1]! };
}

describe('tray icon (D-109)', () => {
  it('Windows gets 16, 24 and 32 px for 100, 150 and 200% scaling; Linux one 32 px image; the files exist', () => {
    expect(trayIconFiles('win32')).toEqual([
      { file: 'tray-16.png', scaleFactor: 1 },
      { file: 'tray-24.png', scaleFactor: 1.5 },
      { file: 'tray-32.png', scaleFactor: 2 },
    ]);
    expect(trayIconFiles('linux')).toEqual([{ file: 'tray-32.png', scaleFactor: 1 }]);
    for (const { file } of trayIconFiles('win32')) expect(fs.existsSync(`resources/brand/${file}`), file).toBe(true);
  });
});

describe('logo in the app (D-109)', () => {
  it('the main window paints the theme background before the renderer, so a start never flashes white', () => {
    for (const dark of [false, true]) {
      expect(windowBackground(dark)).toBe(themeTokens(tokens, dark ? 'dark' : 'light').get('--bg'));
      expect(mainWindowOptions({ preloadPath: 'p', iconPath: 'i', dark }).backgroundColor).toBe(windowBackground(dark));
    }
  });
});

describe('startup loader (D-109)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('is part of index.html with the logo and the app name, and uses the theme colors of both themes', () => {
    expect(indexHtml).toContain(`<div id="${STARTUP_LOADER_ID}" class="startup-loader" role="status" aria-label="Infinity Notes is starting">`);
    expect(indexHtml).toMatch(/src="\.\.\/\.\.\/resources\/brand\/logo-128\.png"/);
    expect(indexHtml).toContain('<p class="startup-name">Infinity Notes</p>');
    for (const file of ['logo-128.png', 'logo-256.png']) expect(fs.existsSync(`resources/brand/${file}`)).toBe(true);
    const light = themeTokens(tokens, 'light');
    const dark = themeTokens(tokens, 'dark');
    expect(colorsAfter(startupCss, startupCss.indexOf('.startup-loader {'))).toEqual({ background: light.get('--bg'), color: light.get('--text') });
    expect(colorsAfter(startupCss, startupCss.indexOf('@media (prefers-color-scheme: dark)'))).toEqual({ background: dark.get('--bg'), color: dark.get('--text') });
    // Motion is reduced to a plain appearance when the system asks for less motion.
    expect(startupCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: startup-appear 0s/);
  });

  it('fades out once the shell is ready and is removed; stickies drop it at once; a second call does nothing', () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="${STARTUP_LOADER_ID}"></div>`;
    dismissStartupLoader({ fade: true });
    const loader = document.getElementById(STARTUP_LOADER_ID)!;
    expect(loader.classList.contains('is-done')).toBe(true);
    vi.advanceTimersByTime(120);
    expect(document.getElementById(STARTUP_LOADER_ID)).toBeNull();
    dismissStartupLoader({ fade: true });

    document.body.innerHTML = `<div id="${STARTUP_LOADER_ID}"></div>`;
    dismissStartupLoader({ fade: false });
    expect(document.getElementById(STARTUP_LOADER_ID)).toBeNull();
  });
});
