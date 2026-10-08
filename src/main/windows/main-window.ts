import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
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

/** Pure description of the main window; unit tested (INF-SHELL-06: native frame, no custom title bar). */
export function mainWindowOptions(opts: { preloadPath: string; iconPath: string; platform?: NodeJS.Platform }): BrowserWindowConstructorOptions {
  return {
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: PRODUCT_NAME,
    show: false,
    autoHideMenuBar: true,
    ...((opts.platform ?? process.platform) === 'linux' ? { icon: opts.iconPath } : {}),
    webPreferences: secureWebPreferences(opts.preloadPath),
  };
}

/** Creates the main window over BrowserWindow for the MainWindowController. */
export function createMainWindowFactory(options: AppWindowFactoryOptions): MainWindowFactory {
  return {
    create(events) {
      const win = new BrowserWindow(mainWindowOptions({ preloadPath: options.preloadPath, iconPath: options.iconPath }));
      const webContentsId = trackWindow(win, { registry: options.registry, sender: { role: 'main' }, hooks: options.windowHooks(), logger: options.logger });
      win.once('ready-to-show', () => win.show());
      win.on('close', (event) => events.onClose(event));
      win.on('closed', () => events.onClosed());
      win.webContents.on('did-start-loading', () => events.onLoadStarted());
      win.webContents.on('did-finish-load', () => events.onLoaded());
      return {
        webContentsId,
        load: () => void win.loadURL(rendererUrl(options.devUrl, '#/')),
        show: () => win.show(),
        focus: () => win.focus(),
        restore: () => win.restore(),
        isMinimized: () => win.isMinimized(),
        close: () => win.close(),
        isDestroyed: () => win.isDestroyed(),
      };
    },
  };
}
