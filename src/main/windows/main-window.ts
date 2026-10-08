import { BrowserWindow } from 'electron';
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
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: PRODUCT_NAME,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon: options.iconPath } : {}),
    webPreferences: {
      preload: options.preloadPath,
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
  });

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
  win.on('closed', () => options.registry.remove(id));
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
