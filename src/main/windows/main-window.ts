import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { PRODUCT_NAME, RENDERER_HOST, RENDERER_SCHEME } from '../../shared/app-identity';
import type { Logger } from '../services/logger';
import type { WindowRegistry } from './window-registry';

export interface MainWindowOptions {
  preloadPath: string;
  iconPath: string;
  registry: WindowRegistry;
  logger: Logger;
  /** Dev server URL, used only when not packaged. */
  devUrl: string | null;
  /** A close of the window by the user or the app; call event.preventDefault() to delay it (flush first). */
  onCloseRequest?: (event: Electron.Event, win: BrowserWindow) => void;
  /** The renderer process ended (crash, kill, out of memory or a clean exit). */
  onRendererGone?: (webContentsId: number, reason: string, win: BrowserWindow) => void;
  /** The main frame committed a new document (a reload or navigation), so the previous document is gone. */
  onNavigated?: (webContentsId: number) => void;
}

/** Pure description of the main window; unit tested (INF-SHELL-06: native frame, no custom title bar). */
export function mainWindowOptions(opts: {
  preloadPath: string;
  iconPath: string;
  platform?: NodeJS.Platform;
}): BrowserWindowConstructorOptions {
  return {
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: PRODUCT_NAME,
    show: false,
    autoHideMenuBar: true,
    ...((opts.platform ?? process.platform) === 'linux' ? { icon: opts.iconPath } : {}),
    webPreferences: {
      preload: opts.preloadPath,
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
    },
  };
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const win = new BrowserWindow(mainWindowOptions({ preloadPath: options.preloadPath, iconPath: options.iconPath }));

  const wc = win.webContents;
  const id = wc.id;
  options.registry.add({
    webContentsId: id,
    role: 'main',
    send: (channel, payload) => wc.send(channel, payload),
    isDestroyed: () => win.isDestroyed() || wc.isDestroyed(),
    isMinimized: () => win.isMinimized(),
    restore: () => win.restore(),
    show: () => win.show(),
    focus: () => win.focus(),
  });
  win.once('ready-to-show', () => win.show());
  win.on('close', (event) => options.onCloseRequest?.(event, win));
  win.on('closed', () => options.registry.remove(id));
  wc.on('render-process-gone', (_event, details) => options.onRendererGone?.(id, details.reason, win));
  wc.on('did-navigate', () => options.onNavigated?.(id));
  wc.on('did-finish-load', () => {
    try {
      const u = new URL(wc.getURL());
      options.logger.info(`renderer:loaded origin=${u.protocol}//${u.host}`);
    } catch {
      options.logger.info('renderer:loaded origin=unknown');
    }
  });

  const url = options.devUrl ?? `${RENDERER_SCHEME}://${RENDERER_HOST}/index.html#/`;
  void win.loadURL(url);
  return win;
}
