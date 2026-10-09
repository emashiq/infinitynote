import { BrowserWindow, nativeTheme, type BrowserWindowConstructorOptions, type TitleBarOverlayOptions } from 'electron';
import { PRODUCT_NAME } from '../../shared/app-identity';
import type { Logger } from '../services/logger';
import type { WindowHooks } from '../window-lifecycle';
import type { MainWindowFactory } from './main-window-controller';
import { rendererUrl, secureWebPreferences, trackWindow } from './secure-window';
import type { WindowRegistry } from './window-registry';

export interface AppWindowFactoryOptions {
  preloadPath: string;
  iconPath: string;
  registry: WindowRegistry;
  logger: Logger;
  /** Dev server URL ending in '/', used only when not packaged. */
  devUrl: string | null;
  /** Renderer and session hooks for each new window. */
  windowHooks(): WindowHooks;
}

/** Height of the app-drawn title bar (UX_SPEC `--header-h`); the OS caption buttons are drawn over its right end. */
export const TITLE_BAR_HEIGHT = 44;

/** The caption-button area in the title bar's colors (tokens `--bg` and `--text` of each theme, D-097). */
export function titleBarOverlay(dark: boolean): TitleBarOverlayOptions {
  return dark ? { color: '#17181d', symbolColor: '#e7e8ee', height: TITLE_BAR_HEIGHT } : { color: '#ffffff', symbolColor: '#1d2030', height: TITLE_BAR_HEIGHT };
}

/**
 * Pure description of the main window; unit tested (INF-SHELL-06, D-097): no OS title bar. The app draws one title bar
 * (menus, search, drag region) and the OS draws minimize, maximize and close over its right end (titleBarOverlay).
 */
export function mainWindowOptions(opts: { preloadPath: string; iconPath: string; platform?: NodeJS.Platform; dark?: boolean }): BrowserWindowConstructorOptions {
  return {
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: PRODUCT_NAME,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(opts.dark ?? false),
    ...((opts.platform ?? process.platform) === 'linux' ? { icon: opts.iconPath } : {}),
    webPreferences: secureWebPreferences(opts.preloadPath),
  };
}

/** Creates the main window over BrowserWindow for the MainWindowController. */
export function createMainWindowFactory(options: AppWindowFactoryOptions): MainWindowFactory {
  return {
    create(events) {
      const win = new BrowserWindow(mainWindowOptions({ preloadPath: options.preloadPath, iconPath: options.iconPath, dark: nativeTheme.shouldUseDarkColors }));
      // The in-app File, View and Help menus replace the OS menu bar (D-097).
      win.removeMenu();
      // The caption buttons follow the theme (the app's setting drives nativeTheme.themeSource).
      const followTheme = () => win.setTitleBarOverlay(titleBarOverlay(nativeTheme.shouldUseDarkColors));
      nativeTheme.on('updated', followTheme);
      win.on('closed', () => nativeTheme.off('updated', followTheme));
      const webContentsId = trackWindow(win, { registry: options.registry, sender: { role: 'main' }, hooks: options.windowHooks(), logger: options.logger });
      win.once('ready-to-show', () => win.show());
      win.on('close', (event) => events.onClose(event));
      win.on('closed', () => events.onClosed());
      win.webContents.on('did-start-loading', () => events.onLoadStarted());
      win.webContents.on('did-finish-load', () => events.onLoaded());
      win.on('focus', () => events.onFocus());
      return {
        webContentsId,
        load: () => void win.loadURL(rendererUrl(options.devUrl, '#/')),
        show: () => win.show(),
        focus: () => win.focus(),
        restore: () => win.restore(),
        isMinimized: () => win.isMinimized(),
        isFocused: () => win.isFocused(),
        flashFrame: (on) => win.flashFrame(on),
        close: () => win.close(),
        isDestroyed: () => win.isDestroyed(),
      };
    },
  };
}
