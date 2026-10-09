import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { WIDGET_MIN, WIDGET_TITLE } from '../../shared/contracts/widget';
import { WIDGET_HASH } from '../../shared/routes';
import type { Placement } from './display-clamp';
import type { AppWindowFactoryOptions } from './main-window';
import { rendererUrl, secureWebPreferences, trackWindow } from './secure-window';
import type { WidgetWindowFactory } from './widget-manager';

/**
 * Pure description of the widget window (D-081, D-097): frameless (its header is the title bar), the shared hardened preferences, the computed size, a
 * position only where it was computed, and keep-on-top only where allowed.
 */
export function widgetWindowOptions(spec: {
  placement: Placement;
  alwaysOnTop: boolean;
  preloadPath: string;
  iconPath: string;
  platform?: NodeJS.Platform;
}): BrowserWindowConstructorOptions {
  const { placement } = spec;
  return {
    width: placement.width,
    height: placement.height,
    ...(placement.x !== undefined && placement.y !== undefined ? { x: placement.x, y: placement.y } : {}),
    minWidth: WIDGET_MIN.width,
    minHeight: WIDGET_MIN.height,
    show: false,
    title: WIDGET_TITLE,
    frame: false,
    fullscreenable: false,
    ...(spec.alwaysOnTop ? { alwaysOnTop: true } : {}),
    ...((spec.platform ?? process.platform) === 'linux' ? { icon: spec.iconPath } : {}),
    webPreferences: secureWebPreferences(spec.preloadPath),
  };
}

/** Creates the widget window over BrowserWindow for the WidgetManager. */
export function createWidgetWindowFactory(options: AppWindowFactoryOptions): WidgetWindowFactory {
  return {
    create(spec, events) {
      const win = new BrowserWindow(widgetWindowOptions({ ...spec, preloadPath: options.preloadPath, iconPath: options.iconPath }));
      // The application menu stays with the main window.
      win.removeMenu();
      const webContentsId = trackWindow(win, { registry: options.registry, sender: { role: 'widget' }, hooks: options.windowHooks(), logger: options.logger });
      win.on('page-title-updated', (event) => event.preventDefault());
      win.once('ready-to-show', () => events.onReadyToShow());
      win.on('close', (event) => events.onClose(event));
      win.on('closed', () => events.onClosed());
      win.on('move', () => events.onBoundsChanged());
      win.on('resize', () => events.onBoundsChanged());
      void win.loadURL(rendererUrl(options.devUrl, WIDGET_HASH));
      return {
        webContentsId,
        show: () => win.show(),
        showInactive: () => win.showInactive(),
        focus: () => win.focus(),
        destroy: () => win.destroy(),
        isDestroyed: () => win.isDestroyed(),
        getBounds: () => win.getBounds(),
        setSize: (w, h) => win.setSize(w, h),
        getContentSize: () => {
          const [w = 0, h = 0] = win.getContentSize();
          return [w, h];
        },
        setContentSize: (w, h) => win.setContentSize(w, h),
        setMinimumSize: (w, h) => win.setMinimumSize(w, h),
        setResizable: (r) => win.setResizable(r),
        setAlwaysOnTop: (on) => win.setAlwaysOnTop(on),
      };
    },
  };
}
